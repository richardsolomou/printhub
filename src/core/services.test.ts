import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalAssetStore } from '../adapters/filesystem'
import { LocalEventBus } from '../adapters/events'
import { SqliteRepository } from '../adapters/sqlite'
import type { Identity, Telemetry } from './types'
import { PrintHubService } from './services'

const telemetry: Telemetry = { capture: async () => undefined, exception: async () => undefined }
const operator: Identity = { id: 'operator', email: 'op@example.com', name: 'Operator', role: 'operator' }

describe('PrintHubService crash recovery', () => {
  let root: string
  let data: string
  let repository: SqliteRepository
  let assets: LocalAssetStore
  let service: PrintHubService

  beforeEach(async () => {
    root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-service-'))
    data = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-service-data-'))
    repository = new SqliteRepository(new Database(':memory:'))
    assets = new LocalAssetStore(root, data)
    await assets.initialize()
    service = new PrintHubService(repository, assets, new LocalEventBus(), telemetry)
  })

  afterEach(async () => {
    repository.close()
    await Promise.all([fs.promises.rm(root, { recursive: true }), fs.promises.rm(data, { recursive: true })])
  })

  async function job() {
    await assets.write('todo/model.stl', new TextEncoder().encode('stl'))
    const id = repository.createJob({ name: 'Model', fileName: 'model.stl', filePath: 'todo/model.stl', quantity: 1, requesterEmail: 'owner@example.com' })
    return id
  }

  it('finishes a delete after restarting between the filesystem and database phases', async () => {
    const id = await job()
    const failure = vi.spyOn(repository, 'deleteJob').mockImplementationOnce(() => { throw new Error('database unavailable') })
    await expect(service.remove(id, operator)).rejects.toThrow('database unavailable')
    expect(repository.getJob(id)).toBeTruthy()
    expect(repository.listOperations()).toHaveLength(1)
    failure.mockRestore()
    await service.recoverOperations()
    expect(repository.getJob(id)).toBeUndefined()
    expect(repository.listOperations()).toHaveLength(0)
  })

  it('journals original and preview assets with distinct deterministic trash paths', async () => {
    await assets.write('todo/with-preview.stl', new TextEncoder().encode('original'))
    await assets.write('.printhub/previews/with-preview.stl', new TextEncoder().encode('preview'))
    const id = repository.createJob({
      name: 'Previewed', fileName: 'with-preview.stl', filePath: 'todo/with-preview.stl',
      previewPath: '.printhub/previews/with-preview.stl', quantity: 1, requesterEmail: 'owner@example.com',
    })
    const failure = vi.spyOn(repository, 'deleteJob').mockImplementationOnce(() => { throw new Error('database unavailable') })
    await expect(service.remove(id, operator)).rejects.toThrow('database unavailable')
    const operation = repository.listOperations()[0]
    expect(operation.payload.kind).toBe('delete')
    if (operation.payload.kind === 'delete') expect(new Set(operation.payload.assets.map((asset) => asset.trashPath)).size).toBe(2)
    failure.mockRestore()
    await service.recoverOperations()
    expect(repository.getJob(id)).toBeUndefined()
  })

  it('does not report a logical delete as failed when trash cleanup fails', async () => {
    const id = await job()
    vi.spyOn(assets, 'purgeTrash').mockRejectedValueOnce(new Error('storage unavailable'))
    await expect(service.remove(id, operator)).resolves.toBeUndefined()
    expect(repository.getJob(id)).toBeUndefined()
    expect(repository.listOperations()).toHaveLength(1)
    await service.recoverOperations()
    expect(repository.listOperations()).toHaveLength(0)
  })

  it('replays a prepared move idempotently after restart', async () => {
    const id = await job()
    const operationId = crypto.randomUUID()
    repository.beginOperation(operationId, {
      kind: 'move', jobId: id, fromStatus: 'todo', toStatus: 'in_progress', count: 1,
      sourcePath: 'todo/model.stl', destinationPath: 'in-progress/model.stl',
    })
    await service.recoverOperations()
    expect(repository.getJob(id)).toMatchObject({ filePath: 'in-progress/model.stl', counts: { todo: 0, in_progress: 1 } })
    expect(await fs.promises.readFile(assets.absolute('in-progress/model.stl'), 'utf8')).toBe('stl')
    expect(repository.listOperations()).toHaveLength(0)
  })

  it('replays a move when the file was renamed before the process stopped', async () => {
    const id = await job()
    const operationId = crypto.randomUUID()
    repository.beginOperation(operationId, {
      kind: 'move', jobId: id, fromStatus: 'todo', toStatus: 'done', count: 1,
      sourcePath: 'todo/model.stl', destinationPath: 'done/model.stl',
    })
    await assets.ensureMoved('todo/model.stl', 'done/model.stl')
    await service.recoverOperations()
    expect(repository.getJob(id)).toMatchObject({ filePath: 'done/model.stl', counts: { todo: 0, done: 1 } })
  })

  it('replays a pending operation before removing an old workflow status', async () => {
    const id = await job()
    const raw = (repository as unknown as { db: Database.Database }).db
    raw.prepare("UPDATE job_statuses SET quantity=0 WHERE job_id=? AND status_id='todo'").run(id)
    raw.prepare("INSERT INTO job_statuses VALUES (?, 'retired', 1, NULL)").run(id)
    await assets.ensureMoved('todo/model.stl', 'retired/model.stl')
    raw.prepare("UPDATE jobs SET file_path='retired/model.stl' WHERE id=?").run(id)
    repository.beginOperation(crypto.randomUUID(), {
      kind: 'move', jobId: id, fromStatus: 'retired', toStatus: 'done', count: 1,
      sourcePath: 'retired/model.stl', destinationPath: 'done/model.stl',
    })
    expect(() => repository.reconcileWorkflow()).toThrow('still has copies')
    await service.recoverOperations()
    repository.reconcileWorkflow()
    expect(repository.getJob(id)).toMatchObject({ counts: { todo: 0, done: 1 }, filePath: 'done/model.stl' })
    expect(repository.getJob(id)?.counts).not.toHaveProperty('retired')
  })

  it('returns public role-aware jobs and enforces requester authorization', async () => {
    const id = await job()
    const requester: Identity = { id: 'requester', email: 'owner@example.com', name: 'Owner', role: 'requester' }
    expect(service.listJobs(requester)[0]).toMatchObject({ _id: id, canEdit: true, hasPreview: false })
    expect(service.listJobs(requester)[0]).not.toHaveProperty('filePath')
    expect(service.listJobs(requester)[0]).not.toHaveProperty('requesterEmail')
    await expect(service.remove(id, requester)).rejects.toMatchObject({ status: 403 })
    await service.moveCopies({ id, from: 'todo', to: 'in_progress', count: 1 }, operator)
    expect(service.listJobs(requester)[0].canEdit).toBe(false)
    expect(() => service.update(id, { notes: 'changed' }, requester)).toThrow()
  })

  it('rejects oversized or malformed updates before persistence', async () => {
    const id = await job()
    expect(() => service.update(id, { name: 'x'.repeat(121) }, operator)).toThrow(expect.objectContaining({ status: 400 }))
    expect(() => service.update(id, { notes: 'x'.repeat(2001) }, operator)).toThrow(expect.objectContaining({ status: 400 }))
    expect(() => service.update(id, { requesterName: 'x'.repeat(61) }, operator)).toThrow(expect.objectContaining({ status: 400 }))
    expect(() => service.update(id, { quantity: 1.5 }, operator)).toThrow(expect.objectContaining({ status: 400 }))
    expect(repository.getJob(id)?.name).toBe('Model')
  })

  it('compensates the original when preview persistence fails', async () => {
    const part = assets.uploadPart('preview-failure-upload')
    await fs.promises.writeFile(part, 'stl')
    vi.spyOn(assets, 'writeUploadPart').mockRejectedValueOnce(new Error('preview full'))
    repository.createUploadSession('preview-failure-upload', operator.id, Date.now() + 60_000, 3)
    await expect(service.createUploadedJob('preview-failure-upload', part, {
      name: 'Model', fileName: 'model.stl', quantity: 1, requesterEmail: 'owner@example.com',
    }, operator, new TextEncoder().encode('preview'))).rejects.toThrow('preview full')
    expect(repository.listJobs()).toHaveLength(0)
    expect(await fs.promises.readdir(assets.absolute('todo'))).toHaveLength(0)
  })

  it('keeps a journaled upload recoverable when metadata insertion fails', async () => {
    const part = assets.uploadPart('metadata-failure-upload')
    await fs.promises.writeFile(part, 'stl')
    const failure = vi.spyOn(repository, 'completeUploadOperation').mockImplementationOnce(() => { throw new Error('database full') })
    repository.createUploadSession('metadata-failure-upload', operator.id, Date.now() + 60_000, 3)
    await expect(service.createUploadedJob('metadata-failure-upload', part, {
      name: 'Model', fileName: 'model.stl', quantity: 1, requesterEmail: 'owner@example.com',
    }, operator)).rejects.toThrow('database full')
    expect(repository.listOperations()).toHaveLength(1)
    expect(await fs.promises.readdir(assets.absolute('todo'))).toHaveLength(1)
    failure.mockRestore()
    const retried = await service.createUploadedJob('metadata-failure-upload', part, {
      name: 'Model', fileName: 'model.stl', quantity: 1, requesterEmail: 'owner@example.com',
    }, operator)
    expect(retried).toBeTruthy()
    expect(repository.listJobs()).toHaveLength(1)
    expect(repository.listOperations()).toHaveLength(0)
  })

  it('durably rejects concurrent move and delete operations for one job', async () => {
    const id = await job()
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const original = assets.ensureMoved.bind(assets)
    vi.spyOn(assets, 'ensureMoved').mockImplementationOnce(async (...args) => { await blocked; return original(...args) })
    const moving = service.moveCopies({ id, from: 'todo', to: 'in_progress', count: 1 }, operator)
    await vi.waitFor(() => expect(repository.listOperations()).toHaveLength(1))
    await expect(service.moveCopies({ id, from: 'todo', to: 'done', count: 1 }, operator)).rejects.toMatchObject({ status: 409 })
    await expect(service.remove(id, operator)).rejects.toMatchObject({ status: 409 })
    expect(() => service.update(id, { quantity: 2 }, operator)).toThrow(expect.objectContaining({ status: 409 }))
    release()
    await moving
    expect(repository.getJob(id)).toMatchObject({ counts: { todo: 0, in_progress: 1 }, filePath: 'in-progress/model.stl' })
    expect(repository.listOperations()).toHaveLength(0)
  })

  it('recovers when the original finalize fails after the preview is durable', async () => {
    const uploadId = 'original-finalize-retry'
    const part = assets.uploadPart(uploadId)
    await fs.promises.writeFile(part, 'stl')
    repository.createUploadSession(uploadId, operator.id, Date.now() + 60_000, 3)
    const original = assets.finalizeUpload.bind(assets)
    let calls = 0
    vi.spyOn(assets, 'finalizeUpload').mockImplementation(async (...args) => {
      calls++
      if (calls === 2) throw new Error('original filesystem failure')
      return original(...args)
    })
    await expect(service.createUploadedJob(uploadId, part, {
      name: 'Model', fileName: 'model.stl', quantity: 1, requesterEmail: operator.email,
    }, operator, new TextEncoder().encode('preview'))).rejects.toThrow('original filesystem failure')
    expect(repository.listOperations()).toHaveLength(1)
    vi.restoreAllMocks()
    await service.recoverOperations()
    expect(repository.listJobs()[0]).toMatchObject({ name: 'Model', previewPath: expect.any(String) })
    expect(repository.listOperations()).toHaveLength(0)
  })

  it('contains rejected optional telemetry promises', async () => {
    const rejecting: Telemetry = { capture: async () => { throw new Error('telemetry down') }, exception: async () => undefined }
    service = new PrintHubService(repository, assets, new LocalEventBus(), rejecting)
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      await job()
      await new Promise((resolve) => setImmediate(resolve))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('terminally reconciles a stale conflicting move instead of poisoning every startup', async () => {
    const id = await job()
    repository.beginOperation(crypto.randomUUID(), {
      kind: 'move', jobId: id, fromStatus: 'todo', toStatus: 'done', count: 1,
      sourcePath: 'todo/model.stl', destinationPath: 'done/model.stl',
    })
    await assets.ensureMoved('todo/model.stl', 'done/model.stl')
    repository.moveCopies({ id, from: 'todo', to: 'in_progress', count: 1, filePath: 'todo/model.stl' })
    await service.recoverOperations()
    expect(repository.listOperations()).toHaveLength(0)
    expect(await fs.promises.readFile(assets.absolute('todo/model.stl'), 'utf8')).toBe('stl')
    await service.recoverOperations()
  })

  it('returns the original job for an ambiguous final-upload retry', async () => {
    const uploadId = 'ambiguous-upload-id'
    const part = assets.uploadPart(uploadId)
    await fs.promises.writeFile(part, 'stl')
    repository.createUploadSession(uploadId, operator.id, Date.now() + 60_000, 3)
    const input = { name: 'Model', fileName: 'model.stl', quantity: 1, requesterEmail: 'owner@example.com' }
    const first = await service.createUploadedJob(uploadId, part, input, operator)
    const second = await service.createUploadedJob(uploadId, part, input, operator)
    expect(second).toBe(first)
    expect(repository.listJobs()).toHaveLength(1)
  })

  it('cleans an upload journal whose staged files disappeared before startup replay', async () => {
    const uploadId = 'missing-staged-upload'
    repository.createUploadSession(uploadId, operator.id, Date.now() + 60_000, 3)
    repository.beginUploadOperation(crypto.randomUUID(), {
      kind: 'upload', uploadId, ownerId: operator.id, jobId: crypto.randomUUID(),
      partPath: assets.uploadPart(uploadId), destinationPath: 'todo/missing.stl',
      job: { name: 'Missing', fileName: 'missing.stl', quantity: 1, requesterEmail: operator.email },
    })
    await service.recoverOperations()
    expect(repository.listOperations()).toHaveLength(0)
    expect(repository.listJobs()).toHaveLength(0)
  })
})
