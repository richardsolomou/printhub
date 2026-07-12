import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { acquireDataDirectoryLease, assertSafeDataFilesystem } from './dataSafety'

describe('data directory safety', () => {
  let temporary: string | undefined

  afterEach(async () => {
    delete process.env.ALLOW_UNSAFE_SQLITE_FILESYSTEM
    vi.restoreAllMocks()
    if (temporary) await fs.promises.rm(temporary, { recursive: true, force: true })
  })

  it('rejects network filesystems unless explicitly overridden', () => {
    vi.spyOn(fs, 'statfsSync').mockReturnValue({ type: 0x6969 } as ReturnType<typeof fs.statfsSync>)
    expect(() => assertSafeDataFilesystem('/data')).toThrow('NFS')
    process.env.ALLOW_UNSAFE_SQLITE_FILESYSTEM = 'true'
    expect(assertSafeDataFilesystem('/data')).toBe('NFS')
  })

  it('allows exactly one live process lease and releases it cleanly', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-lock-'))
    const directory = temporary
    const lease = acquireDataDirectoryLease(directory)
    expect(() => acquireDataDirectoryLease(directory)).toThrow('another PrintHub process')
    lease.release()
    const replacement = acquireDataDirectoryLease(temporary)
    replacement.release()
    await expect(fs.promises.stat(path.join(temporary, 'printhub.lock'))).resolves.toMatchObject({ isFile: expect.any(Function) })
  })

  it('releases the operating system lock idempotently', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-lock-'))
    const lease = acquireDataDirectoryLease(temporary)
    lease.release()
    expect(() => lease.release()).not.toThrow()
    const replacement = acquireDataDirectoryLease(temporary)
    replacement.release()
  })
})
