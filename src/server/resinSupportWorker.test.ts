import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { generateResinSupports } from './resinSupportWorker'

const originalDataDirectory = process.env.DATA_DIR
const originalWorkerUrl = process.env.RESIN_SUPPORT_WORKER_URL

afterEach(() => {
  if (originalDataDirectory === undefined) delete process.env.DATA_DIR
  else process.env.DATA_DIR = originalDataDirectory
  if (originalWorkerUrl === undefined) delete process.env.RESIN_SUPPORT_WORKER_URL
  else process.env.RESIN_SUPPORT_WORKER_URL = originalWorkerUrl
})

describe('resin support worker', () => {
  it('caches generated support geometry by the complete project bytes', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'printhub-support-test-'))
    process.env.DATA_DIR = directory
    let requests = 0
    const server = http.createServer((request, response) => {
      requests++
      request.resume()
      response.writeHead(200, { 'Content-Type': 'model/stl', 'X-Model-Elevation': '6.5' })
      response.end(Buffer.from([1, 2, 3, 4]))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('test server did not bind')
    process.env.RESIN_SUPPORT_WORKER_URL = `http://127.0.0.1:${address.port}`

    try {
      const project = new Uint8Array([9, 8, 7])
      const [first, second] = await Promise.all([generateResinSupports(project), generateResinSupports(project)])
      const cached = await generateResinSupports(project)

      expect([...first.supports]).toEqual([1, 2, 3, 4])
      expect(first.elevationMm).toBe(6.5)
      expect([...second.supports]).toEqual([1, 2, 3, 4])
      expect([...cached.supports]).toEqual([1, 2, 3, 4])
      expect(requests).toBe(1)
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  it('reports a missing worker as unavailable', async () => {
    delete process.env.RESIN_SUPPORT_WORKER_URL

    await expect(generateResinSupports(new Uint8Array([1]))).rejects.toMatchObject({ status: 503 })
  })

  it('regenerates support geometry when cached metadata is corrupt', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'printhub-support-test-'))
    process.env.DATA_DIR = directory
    let requests = 0
    const server = http.createServer((request, response) => {
      requests++
      request.resume()
      response.writeHead(200, { 'Content-Type': 'model/stl', 'X-Model-Elevation': '7' })
      response.end(Buffer.from([1, 2, 3, requests]))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('test server did not bind')
    process.env.RESIN_SUPPORT_WORKER_URL = `http://127.0.0.1:${address.port}`

    try {
      const project = new Uint8Array([4, 5, 6])
      await generateResinSupports(project)
      const cacheDirectory = path.join(directory, 'resin-support-cache')
      const metadataFile = (await fs.readdir(cacheDirectory)).find((file) => file.endsWith('.json'))
      if (!metadataFile) throw new Error('cache metadata was not created')
      await fs.writeFile(path.join(cacheDirectory, metadataFile), 'not json')

      const regenerated = await generateResinSupports(project)

      expect([...regenerated.supports]).toEqual([1, 2, 3, 2])
      expect(requests).toBe(2)
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})
