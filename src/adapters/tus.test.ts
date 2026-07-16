import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TusUploadStore } from './tus'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.promises.rm(root, { recursive: true, force: true })))
})

describe('TusUploadStore', () => {
  it('removes partial data and config state idempotently', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-tus-store-'))
    roots.push(root)
    const store = new TusUploadStore(root)
    const uploadId = 'partial-upload-id'
    await fs.promises.mkdir(store.datastore.directory, { recursive: true })
    await fs.promises.writeFile(path.join(store.datastore.directory, uploadId), 'partial')

    await store.remove(uploadId)
    await store.remove(uploadId)

    await expect(fs.promises.stat(path.join(store.datastore.directory, uploadId))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(store.datastore.configstore.get(uploadId)).resolves.toBeUndefined()
  })
})
