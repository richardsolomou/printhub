import type { AssetStore, DeleteOperation, EventBus, Identity, MoveOperation, NewJob, PendingOperation, Repository, Telemetry, UploadOperation } from './types'
import { initialStatus, statusById, workflow } from './workflow'

export class PrintHubService {
  constructor(
    private repository: Repository,
    private assets: AssetStore,
    private events: EventBus,
    private telemetry: Telemetry,
  ) {}

  listJobs(identity: Identity) {
    return this.repository.listJobs().map(({ fileName: _fileName, filePath: _filePath, requesterEmail, thumbnail: _thumbnail, previewPath, ...job }) => ({
      ...job,
      hasPreview: !!previewPath,
      canEdit: identity.role === 'operator' || (requesterEmail === identity.email && !workflow.statuses.slice(1).some((status) => job.counts[status.id] > 0)),
    }))
  }

  listPeople() {
    return this.repository.listPeople()
  }

  getJob(id: string) {
    return this.repository.getJob(id)
  }

  createJob(input: Parameters<Repository['createJob']>[0], identity: Identity) {
    const id = this.repository.createJob(input)
    this.changed('request.created')
    this.capture(identity.id, 'print_job_created', { job_id: id, quantity: input.quantity })
    return id
  }

  async createUploadedJob(uploadId: string, partPath: string, input: Omit<NewJob, 'filePath' | 'previewPath'>, identity: Identity, preview?: Uint8Array) {
    const completed = this.repository.getCompletedUpload(uploadId, identity.id)
    if (completed) return completed
    const filePath = this.assets.createPath(input.fileName)
    const previewPath = preview ? this.assets.previewPath(filePath) : undefined
    const previewPartPath = preview ? this.assets.uploadPreviewPart(uploadId) : undefined
    const operation: UploadOperation = {
      kind: 'upload', uploadId, ownerId: identity.id, jobId: crypto.randomUUID(), partPath,
      destinationPath: filePath, previewPartPath, previewDestinationPath: previewPath, job: input,
    }
    try {
      if (preview && previewPartPath) await this.assets.writeUploadPart(previewPartPath, preview)
      this.repository.beginUploadOperation(crypto.randomUUID(), operation)
    } catch (error) {
      if (previewPartPath) await fsRemove(previewPartPath)
      throw error
    }
    const pending = this.repository.listOperations().find((candidate) => candidate.payload.kind === 'upload' && candidate.payload.uploadId === uploadId)
    if (!pending) {
      const result = this.repository.getCompletedUpload(uploadId, identity.id)
      if (result) return result
      throw new Error('upload operation was not created')
    }
    const id = await this.resumeOperation(pending)
    this.changed('request.created')
    this.capture(identity.id, 'print_job_created', { job_id: id, quantity: input.quantity })
    return id!
  }

  async moveCopies(input: { id: string; from: string; to: string; count: number; order?: number }, identity: Identity) {
    this.requireOperator(identity)
    statusById(input.from)
    statusById(input.to)
    const job = this.requiredJob(input.id)
    if (!(input.from in job.counts) || !(input.to in job.counts) || input.from === input.to || !Number.isInteger(input.count) || input.count < 1 || job.counts[input.from] < input.count) {
      throw new Response('invalid move', { status: 409 })
    }
    const counts = { ...job.counts, [input.from]: job.counts[input.from] - input.count, [input.to]: job.counts[input.to] + input.count }
    const target = workflow.statuses.find((status) => counts[status.id] > 0)?.id ?? workflow.statuses.at(-1)!.id
    const current = workflow.statuses.find((status) => job.counts[status.id] > 0)?.id ?? initialStatus().id
    const filePath = target === current ? job.filePath : this.assets.destinationPath(job.filePath, target)
    if (filePath !== job.filePath) {
      const operationId = crypto.randomUUID()
      const operation: MoveOperation = {
        kind: 'move', jobId: input.id, fromStatus: input.from, toStatus: input.to, count: input.count,
        order: input.order, sourcePath: job.filePath, destinationPath: filePath,
      }
      this.repository.beginOperation(operationId, operation)
      await this.resumeOperation({ id: operationId, state: 'prepared', payload: operation })
    } else {
      this.repository.moveCopies({ ...input, filePath })
    }
    this.changed('request.copiesMoved')
    this.capture(identity.id, 'print_job_copies_moved', input)
  }

  reorder(id: string, status: string, order: number, identity: Identity) {
    this.requireOperator(identity)
    statusById(status)
    if (!Number.isFinite(order)) throw new Error('invalid order')
    this.repository.reorderJob(id, status, order)
    this.changed('request.reordered')
  }

  update(id: string, fields: { name?: string; quantity?: number; requesterName?: string; notes?: string }, identity: Identity) {
    if (typeof id !== 'string' || id.length > 100 ||
      (fields.name !== undefined && (typeof fields.name !== 'string' || !fields.name.trim() || fields.name.length > 120)) ||
      (fields.requesterName !== undefined && (typeof fields.requesterName !== 'string' || fields.requesterName.length > 60)) ||
      (fields.notes !== undefined && (typeof fields.notes !== 'string' || fields.notes.length > 2000)) ||
      (fields.quantity !== undefined && (typeof fields.quantity !== 'number' || !Number.isInteger(fields.quantity) || fields.quantity < 1 || fields.quantity > 50))) {
      throw new Response('invalid update', { status: 400 })
    }
    const job = this.requiredJob(id)
    if (identity.role !== 'operator') {
      const started = workflow.statuses.slice(1).some((status) => job.counts[status.id] > 0)
      if (job.requesterEmail !== identity.email || started) throw new Response('forbidden', { status: 403 })
      fields = { quantity: fields.quantity, notes: fields.notes }
    }
    this.repository.updateJob(id, {
      ...fields,
      name: fields.name?.trim(),
      requesterName: fields.requesterName?.trim(),
      notes: fields.notes?.trim(),
    })
    this.changed('request.updated')
  }

  async remove(id: string, identity: Identity) {
    this.requireOperator(identity)
    const job = this.requiredJob(id)
    const operationId = crypto.randomUUID()
    const operation: DeleteOperation = {
      kind: 'delete',
      jobId: id,
      assets: [job.filePath, job.previewPath].filter((value): value is string => !!value)
        .map((originalPath) => ({ originalPath, trashPath: this.assets.trashPath(operationId, originalPath) })),
    }
    this.repository.beginOperation(operationId, operation)
    await this.resumeOperation({ id: operationId, state: 'prepared', payload: operation })
    this.changed('request.deleted')
    this.capture(identity.id, 'print_job_deleted', { job_id: id })
  }

  async recoverOperations() {
    for (const operation of this.repository.listOperations()) await this.resumeOperation(operation)
  }

  private async resumeOperation(operation: PendingOperation) {
    if (operation.payload.kind === 'move') {
      const job = this.repository.getJob(operation.payload.jobId)
      if (!job) { this.repository.abandonOperation(operation.id); return }
      if (operation.state !== 'committed' && (job.counts[operation.payload.fromStatus] ?? 0) < operation.payload.count) {
        const [sourceExists, destinationExists] = await Promise.all([
          this.assets.exists(operation.payload.sourcePath), this.assets.exists(operation.payload.destinationPath),
        ])
        if (!sourceExists && destinationExists && job.filePath === operation.payload.sourcePath) {
          await this.assets.ensureMoved(operation.payload.destinationPath, operation.payload.sourcePath)
        }
        this.repository.abandonOperation(operation.id)
        return
      }
      if (operation.state === 'prepared') {
        await this.assets.ensureMoved(operation.payload.sourcePath, operation.payload.destinationPath)
        this.repository.markOperationAssetsMoved(operation.id)
      }
      if (operation.state !== 'committed') {
        this.repository.completeMoveOperation(operation.id, {
          id: operation.payload.jobId,
          from: operation.payload.fromStatus,
          to: operation.payload.toStatus,
          count: operation.payload.count,
          order: operation.payload.order,
          filePath: operation.payload.destinationPath,
        })
      }
      this.repository.finishOperation(operation.id)
      return
    }

    if (operation.payload.kind === 'upload') {
      if (operation.state === 'prepared') {
        try {
          if (operation.payload.previewPartPath && operation.payload.previewDestinationPath) {
            await this.assets.finalizeUpload(operation.payload.previewPartPath, operation.payload.previewDestinationPath)
          }
          await this.assets.finalizeUpload(operation.payload.partPath, operation.payload.destinationPath)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          await Promise.allSettled([
            this.assets.remove(operation.payload.destinationPath),
            operation.payload.previewDestinationPath ? this.assets.remove(operation.payload.previewDestinationPath) : Promise.resolve(),
          ])
          this.repository.abandonOperation(operation.id)
          return
        }
        this.repository.markOperationAssetsMoved(operation.id)
      }
      const id = this.repository.completeUploadOperation(operation.id, operation.payload)
      this.repository.finishOperation(operation.id)
      return id
    }

    if (operation.state === 'prepared') {
      for (const asset of operation.payload.assets) {
        const [originalExists, trashExists] = await Promise.all([this.assets.exists(asset.originalPath), this.assets.exists(asset.trashPath)])
        if (!originalExists && !trashExists) continue
        await this.assets.ensureMoved(asset.originalPath, asset.trashPath)
      }
      this.repository.markOperationAssetsMoved(operation.id)
    }
    if (operation.state !== 'committed') this.repository.completeDeleteOperation(operation.id, operation.payload.jobId)
    const purged = await Promise.allSettled(operation.payload.assets.map((asset) => this.assets.purgeTrash(asset.trashPath)))
    if (purged.every((result) => result.status === 'fulfilled')) this.repository.finishOperation(operation.id)
  }

  private requiredJob(id: string) {
    const job = this.repository.getJob(id)
    if (!job) throw new Response('not found', { status: 404 })
    return job
  }

  private requireOperator(identity: Identity) {
    if (identity.role !== 'operator') throw new Response('forbidden', { status: 403 })
  }

  private changed(event: string) {
    this.events.publish(event)
  }

  private capture(identity: string, event: string, properties?: Record<string, unknown>) {
    void this.telemetry.capture(identity, event, properties).catch(() => undefined)
  }
}

async function fsRemove(filePath: string) {
  const { promises } = await import('node:fs')
  await promises.rm(filePath, { force: true })
}
