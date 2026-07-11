import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { acceptUploadChunk, contentLengthAllowed, UploadLockRegistry, UploadRequestLimiter, validSameOrigin } from './uploadGuards'

describe('upload request guards', () => {
  it('accepts an identical retry after an ambiguous response and resumes after restart', async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-chunk-'))
    const file = path.join(directory, 'upload.part')
    const first = new TextEncoder().encode('first')
    expect(await acceptUploadChunk(file, 0, first)).toBe(5)
    expect(await acceptUploadChunk(file, 0, first)).toBe(5)
    expect(await acceptUploadChunk(file, 5, new TextEncoder().encode('second'))).toBe(11)
    await expect(acceptUploadChunk(file, 0, new TextEncoder().encode('other'))).rejects.toMatchObject({ status: 409 })
    expect(await fs.promises.readFile(file, 'utf8')).toBe('firstsecond')
    await fs.promises.rm(directory, { recursive: true, force: true })
  })
  it('serializes an upload and rejects a different identity', async () => {
    const locks = new UploadLockRegistry()
    const first = await locks.acquire('upload', 'owner-a')
    expect(first?.fresh).toBe(true)
    await expect(locks.acquire('upload', 'owner-b')).resolves.toBeUndefined()
    let acquired = false
    const secondPromise = locks.acquire('upload', 'owner-a').then((lock) => { acquired = true; return lock })
    await Promise.resolve()
    expect(acquired).toBe(false)
    first!.release(false)
    const second = await secondPromise
    expect(second?.fresh).toBe(false)
    second!.release(true)
  })

  it('accepts only same-origin browser requests', () => {
    expect(validSameOrigin(new Request('https://print.test/api/upload', { headers: { origin: 'https://print.test', 'sec-fetch-site': 'same-origin' } }))).toBe(true)
    expect(validSameOrigin(new Request('https://print.test/api/upload', { headers: { origin: 'https://evil.test', 'sec-fetch-site': 'cross-site' } }))).toBe(false)
    expect(validSameOrigin(new Request('https://print.test/api/upload'))).toBe(false)
  })

  it('bounds incomplete uploads per identity and expires abandoned locks', async () => {
    const locks = new UploadLockRegistry(10, 2, 100)
    const first = await locks.acquire('upload-one', 'owner')
    const second = await locks.acquire('upload-two', 'owner')
    expect(first?.reserve(60)).toBe(true)
    expect(second?.reserve(41)).toBe(false)
    expect(second?.reserve(40)).toBe(true)
    const third = await locks.acquire('upload-three', 'owner')
    expect(third?.reserve(1)).toBe(false)
    first!.release(false); second!.release(false); third!.release(false)
    expect(locks.expire(Date.now() + 11)).toEqual([])
    expect(locks.activeIds()).toEqual(new Set())
  })

  it('drops fresh rejected IDs as soon as their request releases', async () => {
    const locks = new UploadLockRegistry()
    for (let index = 0; index < 100; index++) {
      const lock = await locks.acquire(`rejected-${index}`, 'owner')
      lock!.release(false)
    }
    expect(locks.expire(Number.MAX_SAFE_INTEGER)).toEqual([])
  })

  it('syncs the parent directory before acknowledging a new part', async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-dir-sync-'))
    const file = path.join(directory, 'new.part')
    const open = fs.promises.open.bind(fs.promises)
    let directorySynced = false
    const spy = vi.spyOn(fs.promises, 'open').mockImplementation(async (target, flags, mode) => {
      const handle = await open(target, flags, mode)
      if (String(target) === directory) {
        const sync = handle.sync.bind(handle)
        vi.spyOn(handle, 'sync').mockImplementation(async () => { directorySynced = true; return sync() })
      }
      return handle
    })
    await acceptUploadChunk(file, 0, new TextEncoder().encode('durable'))
    expect(directorySynced).toBe(true)
    spy.mockRestore()
    await fs.promises.rm(directory, { recursive: true, force: true })
  })

  it('rejects oversized or malformed declared request bodies before parsing', () => {
    expect(contentLengthAllowed(new Request('https://print.test'), 100)).toBe(false)
    expect(contentLengthAllowed(new Request('https://print.test', { headers: { 'content-length': '101' } }), 100)).toBe(false)
    expect(contentLengthAllowed(new Request('https://print.test', { headers: { 'content-length': 'invalid' } }), 100)).toBe(false)
    expect(contentLengthAllowed(new Request('https://print.test', { headers: { 'content-length': '100' } }), 100)).toBe(true)
  })

  it('bounds concurrent multipart parsing globally and per identity', () => {
    const limiter = new UploadRequestLimiter(2, 1)
    const first = limiter.enter('owner-a')
    expect(first).toBeTypeOf('function')
    expect(limiter.enter('owner-a')).toBeUndefined()
    const second = limiter.enter('owner-b')
    expect(second).toBeTypeOf('function')
    expect(limiter.enter('owner-c')).toBeUndefined()
    first!()
    expect(limiter.enter('owner-c')).toBeTypeOf('function')
    second!()
  })
})
