import fs from 'node:fs'
import path from 'node:path'

type Lock = { owner: string; tail: Promise<void>; pending: number; bytes: number; expiresAt: number }

export class UploadLockRegistry {
  private locks = new Map<string, Lock>()

  constructor(
    private ttlMs = 24 * 60 * 60 * 1000,
    private maxUploadsPerOwner = 3,
    private maxBytesPerOwner = 1024 * 1024 * 1024,
  ) {}

  expire(now = Date.now()) {
    const expired: string[] = []
    for (const [id, lock] of this.locks) if (lock.pending === 0 && lock.expiresAt <= now) {
      this.locks.delete(id)
      expired.push(id)
    }
    return expired
  }

  async acquire(uploadId: string, owner: string) {
    const existing = this.locks.get(uploadId)
    if (existing && existing.owner !== owner) return undefined
    let unlock!: () => void
    const previous = existing?.tail ?? Promise.resolve()
    const tail = new Promise<void>((resolve) => { unlock = resolve })
    const lock: Lock = existing
      ? { ...existing, tail, pending: existing.pending + 1, expiresAt: Date.now() + this.ttlMs }
      : { owner, tail, pending: 1, bytes: 0, expiresAt: Date.now() + this.ttlMs }
    this.locks.set(uploadId, lock)
    await previous
    return {
      fresh: !existing,
      reserve: (bytes: number) => {
        const owned = [...this.locks.entries()].filter(([id, value]) => id !== uploadId && value.owner === owner)
        if (owned.length >= this.maxUploadsPerOwner || owned.reduce((sum, [, value]) => sum + value.bytes, 0) + bytes > this.maxBytesPerOwner) return false
        const current = this.locks.get(uploadId)
        if (!current) return false
        current.bytes = bytes
        current.expiresAt = Date.now() + this.ttlMs
        return true
      },
      release: (finished: boolean) => {
        unlock()
        const current = this.locks.get(uploadId)
        if (!current) return
        current.pending = Math.max(0, current.pending - 1)
        current.expiresAt = Date.now() + this.ttlMs
        if (current.pending === 0 && current.tail === tail) this.locks.delete(uploadId)
      },
    }
  }

  activeIds() {
    return new Set([...this.locks].filter(([, lock]) => lock.pending > 0).map(([id]) => id))
  }
}

export class UploadRequestLimiter {
  private total = 0
  private owners = new Map<string, number>()

  constructor(private maxTotal = 4, private maxPerOwner = 2) {}

  enter(owner: string) {
    const owned = this.owners.get(owner) ?? 0
    if (this.total >= this.maxTotal || owned >= this.maxPerOwner) return undefined
    this.total++
    this.owners.set(owner, owned + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      this.total--
      const remaining = (this.owners.get(owner) ?? 1) - 1
      if (remaining) this.owners.set(owner, remaining)
      else this.owners.delete(owner)
    }
  }
}

export function contentLengthAllowed(request: Request, maxBytes: number) {
  const value = request.headers.get('content-length')
  if (!value) return false
  const length = Number(value)
  return Number.isSafeInteger(length) && length >= 0 && length <= maxBytes
}

export function validSameOrigin(request: Request) {
  const origin = request.headers.get('origin')
  const site = request.headers.get('sec-fetch-site')
  return origin === new URL(request.url).origin && (!site || site === 'same-origin')
}

export async function acceptUploadChunk(filePath: string, offset: number, bytes: Uint8Array) {
  const existed = await fs.promises.stat(filePath).then(() => true).catch(() => false)
  const currentSize = existed ? (await fs.promises.stat(filePath)).size : 0
  if (currentSize !== offset && currentSize !== offset + bytes.byteLength) throw new Response('out-of-order chunk', { status: 409 })
  const chunk = Buffer.from(bytes)
  if (currentSize === offset + chunk.length) {
    const handle = await fs.promises.open(filePath, 'r')
    try {
      const existing = Buffer.alloc(chunk.length)
      const { bytesRead } = await handle.read(existing, 0, existing.length, offset)
      if (bytesRead !== existing.length || !existing.equals(chunk)) throw new Response('chunk does not match previously accepted data', { status: 409 })
    } finally {
      await handle.close()
    }
    return currentSize
  }
  const handle = await fs.promises.open(filePath, 'a')
  try {
    await handle.write(chunk)
    await handle.sync()
  } finally {
    await handle.close()
  }
  if (!existed) {
    const directory = await fs.promises.open(path.dirname(filePath), 'r')
    try { await directory.sync() } finally { await directory.close() }
  }
  return offset + chunk.length
}
