import fs from 'node:fs'
import path from 'node:path'
import { EVENTS, Server } from '@tus/server'
import { z } from 'zod'
import { app } from './app'
import { validSourceUrl } from '../core/services'
import { TusUploadStore, UPLOAD_TTL } from '../adapters/tus'
import type { NewUploadedRequestInput } from '../core/services'
import type { Identity, Repository } from '../core/types'
import { UploadRequestLimiter, validSameOrigin } from './uploadGuards'
import { assertUploadCapacity } from './operations'
import { THREE_MF_UPLOAD_LIMITS } from '../core/mesh/threeMf'
import { requireModelFormat } from '../core/modelFormat'
import { InvalidThreeMfError, validateThreeMfFile } from './assets/modelValidation'

const MAX_TOTAL_BYTES = 1024 * 1024 * 1024
const uploadRequests = new UploadRequestLimiter()
const requestIdentities = new WeakMap<object, Identity>()
const requestUploadLocks = new WeakMap<object, string>()
const requestUploadCreations = new WeakMap<object, { uploadId: string; ownerId: string; created: boolean }>()
const uploadLocks = new Map<string, Promise<void>>()
type OwnerUploadState = { active: number; deleting: boolean; drained?: () => void }
const ownerUploadStates = new Map<string, OwnerUploadState>()
const tusUploads = new TusUploadStore()
const store = tusUploads.datastore

const optionalMetadataString = (max: number) =>
  z.preprocess((value) => (value === null ? undefined : value), z.string().trim().max(max).optional())

const metadataSchema = z.object({
  filename: z
    .string()
    .max(255)
    .transform((value) => path.basename(value))
    .refine((value) => /\.(?:stl|3mf)$/i.test(value), 'only .stl and .3mf files are accepted'),
  name: z.string().trim().min(1).max(120),
  quantity: z.coerce.number().int().min(1).max(50),
  notes: optionalMetadataString(2000),
  sourceUrl: optionalMetadataString(500).refine((value) => !value || validSourceUrl(value), 'source URL must be an http(s) link'),
  requestedPrintType: z.enum(['resin', 'filament']),
})

class UploadValidationError extends Error {
  status_code: number
  body: string

  constructor(message: string, status = 400) {
    super(message)
    this.status_code = status
    this.body = message
  }
}

function tusError(error: unknown): Error & { status_code: number; body: string } {
  if (error instanceof Response) {
    const wrapped = new Error(error.statusText || 'upload rejected') as Error & { status_code: number; body: string }
    wrapped.status_code = error.status
    wrapped.body = error.statusText || 'upload rejected'
    return wrapped
  }
  if (error instanceof z.ZodError) {
    const wrapped = new Error(error.issues[0]?.message ?? 'invalid upload metadata') as Error & { status_code: number; body: string }
    wrapped.status_code = 400
    wrapped.body = wrapped.message
    return wrapped
  }
  const wrapped = (error instanceof Error ? error : new Error(String(error))) as Error & { status_code: number; body: string }
  wrapped.status_code ||= 500
  wrapped.body ||= wrapped.message
  return wrapped
}

function identityFor(request: object) {
  const identity = requestIdentities.get(request)
  if (!identity) throw tusError(new Response('unauthenticated', { status: 401, statusText: 'unauthenticated' }))
  return identity
}

function uploadExpired(creationDate: string | undefined) {
  return Date.now() > uploadExpiresAt(creationDate)
}

function uploadExpiresAt(creationDate: string | undefined) {
  const createdAt = creationDate ? new Date(creationDate).getTime() : Number.NaN
  if (!Number.isFinite(createdAt)) throw new Response('upload creation date is invalid', { status: 410 })
  return createdAt + UPLOAD_TTL
}

async function finalizeUpload(
  uploadId: string,
  metadata: Record<string, string | null> | undefined,
  sourcePath: string,
  identity: Identity,
) {
  const instance = await app()
  const completed = instance.repository.getCompletedUpload(uploadId, identity.id)
  if (completed) return completed
  const parsed = metadataSchema.parse(metadata ?? {})
  await validateUploadedModel(sourcePath, parsed.filename)
  const request: NewUploadedRequestInput = {
    name: parsed.name,
    fileName: parsed.filename,
    quantity: parsed.quantity,
    notes: parsed.notes || undefined,
    sourceUrl: parsed.sourceUrl || undefined,
    requestedPrintType: parsed.requestedPrintType,
  }
  const part = instance.staging.uploadPart(uploadId)
  if ((await instance.staging.size(part)) === 0) await instance.staging.copyUploadPart(sourcePath, part)
  const requestId = await instance.service.createUploadedRequest(uploadId, part, request, identity)
  instance.assetQueue.enqueue(requestId)
  return requestId
}

async function finalizeUploadForRequest(
  request: object,
  uploadId: string,
  metadata: Record<string, string | null> | undefined,
  sourcePath: string,
  identity: Identity,
) {
  const finalize = () => finalizeUpload(uploadId, metadata, sourcePath, identity)
  return requestUploadLocks.get(request) === uploadId ? finalize() : withUploadLock(uploadId, finalize)
}

async function withUploadLock<T>(uploadId: string, work: () => Promise<T>) {
  const previous = uploadLocks.get(uploadId) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.then(() => current)
  uploadLocks.set(uploadId, tail)
  await previous
  try {
    return await work()
  } finally {
    release()
    if (uploadLocks.get(uploadId) === tail) uploadLocks.delete(uploadId)
  }
}

export async function withOwnedUploadLocks<T>(repository: Repository, ownerId: string, work: () => Promise<T>) {
  const state = ownerUploadState(ownerId)
  state.deleting = true
  if (state.active) await new Promise<void>((resolve) => (state.drained = resolve))
  try {
    const uploadIds = repository.uploadIdsOwnedBy(ownerId).sort()
    const run = (index: number): Promise<T> =>
      index === uploadIds.length ? work() : withUploadLock(uploadIds[index], () => run(index + 1))
    return await run(0)
  } catch (error) {
    state.deleting = false
    ownerUploadStates.delete(ownerId)
    throw error
  }
}

function ownerUploadState(ownerId: string) {
  const existing = ownerUploadStates.get(ownerId)
  if (existing) return existing
  const state: OwnerUploadState = { active: 0, deleting: false }
  ownerUploadStates.set(ownerId, state)
  return state
}

function enterOwnerUpload(ownerId: string) {
  const state = ownerUploadState(ownerId)
  if (state.deleting) throw new Response('account deletion is in progress', { status: 410, statusText: 'account deletion is in progress' })
  state.active++
  return () => {
    state.active--
    if (state.active === 0) {
      state.drained?.()
      state.drained = undefined
      if (!state.deleting) ownerUploadStates.delete(ownerId)
    }
  }
}

async function validateUploadedModel(sourcePath: string, fileName: string) {
  if (requireModelFormat(fileName) !== '3mf') return
  try {
    await validateThreeMfFile(sourcePath)
  } catch (error) {
    if (error instanceof InvalidThreeMfError) throw new UploadValidationError(error.message)
    throw error
  }
}

async function discardRejectedUpload(uploadId: string, identity: Identity) {
  const instance = await app()
  const cleanup = await Promise.allSettled([instance.staging.remove(instance.staging.uploadPart(uploadId)), tusUploads.remove(uploadId)])
  const failures = cleanup.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failures.length)
    throw new AggregateError(
      failures.map(({ reason }) => reason),
      'rejected upload cleanup failed; cleanup will retry after expiry',
    )
  instance.repository.deleteUploadSession(uploadId, identity.id)
}

const server = new Server({
  path: '/api/upload',
  datastore: store,
  maxSize: MAX_TOTAL_BYTES,
  relativeLocation: true,
  namingFunction: () => crypto.randomUUID(),
  onIncomingRequest: async (request, uploadId) => {
    const identity = identityFor(request)
    try {
      const instance = await app()
      if (request.method !== 'POST') {
        const upload = await store.getUpload(uploadId).catch(() => undefined)
        if (!upload) return
        if (request.method === 'DELETE') {
          instance.repository.refreshUploadSession(uploadId, identity.id)
          return
        }
        if (uploadExpired(upload.creation_date)) {
          await Promise.all([tusUploads.remove(uploadId), instance.staging.remove(instance.staging.uploadPart(uploadId))])
          instance.repository.deleteUploadSession(uploadId, identity.id)
          throw new Response('upload expired', { status: 410, statusText: 'upload expired' })
        }
        instance.repository.refreshUploadSession(uploadId, identity.id)
        if (upload?.size !== undefined && upload.offset === upload.size && upload.storage?.path) {
          await finalizeUploadForRequest(request, upload.id, upload.metadata, upload.storage.path, identity)
        }
      }
    } catch (error) {
      if (error instanceof UploadValidationError) await discardRejectedUpload(uploadId, identity)
      throw tusError(error)
    }
  },
  onUploadCreate: async (request, upload) => {
    try {
      const identity = identityFor(request)
      const instance = await app()
      const parsed = metadataSchema.parse(upload.metadata ?? {})
      if (upload.size === undefined) throw new UploadValidationError('Deferred upload lengths are not supported')
      if (requireModelFormat(parsed.filename) === '3mf' && (upload.size ?? 0) > THREE_MF_UPLOAD_LIMITS.archiveBytes) {
        throw new UploadValidationError(`3MF archive exceeds the ${THREE_MF_UPLOAD_LIMITS.archiveBytes / 1024 / 1024} MiB limit`, 413)
      }
      await assertUploadCapacity(instance.staging.root, upload.size ?? 0)
      const session = instance.repository.createUploadSession(upload.id, identity.id, uploadExpiresAt(upload.creation_date), 3)
      if (session.fresh) requestUploadCreations.set(request, { uploadId: upload.id, ownerId: identity.id, created: false })
      if (
        !instance.repository.reserveUpload(upload.id, identity.id, upload.size ?? 0, {
          count: 3,
          bytes: MAX_TOTAL_BYTES,
        })
      ) {
        throw new Response('too many incomplete uploads', { status: 429, statusText: 'too many incomplete uploads' })
      }
      return { metadata: upload.metadata }
    } catch (error) {
      throw tusError(error)
    }
  },
  onUploadFinish: async (request, upload) => {
    const identity = identityFor(request)
    try {
      if (!upload.storage?.path) throw new Error('completed upload has no staged file')
      const requestId = await finalizeUploadForRequest(request, upload.id, upload.metadata, upload.storage.path, identity)
      return { headers: { 'X-Request-Id': requestId } }
    } catch (error) {
      if (error instanceof UploadValidationError) await discardRejectedUpload(upload.id, identity)
      throw tusError(error)
    }
  },
})

server.on(EVENTS.POST_CREATE, (request) => {
  const creation = requestUploadCreations.get(request)
  if (creation) creation.created = true
})

async function rollbackFailedUploadCreation(request: object, repository: Repository) {
  const creation = requestUploadCreations.get(request)
  requestUploadCreations.delete(request)
  if (!creation || creation.created) return
  repository.deleteUploadSession(creation.uploadId, creation.ownerId)
  await tusUploads.remove(creation.uploadId)
}

export async function handleUpload(request: Request) {
  if (!validSameOrigin(request)) return Response.json({ error: 'cross-origin upload rejected' }, { status: 403 })
  const instance = await app()
  if (!instance.storageReady)
    return Response.json({ error: 'storage is not ready — an admin needs to fix Settings → Storage first' }, { status: 503 })
  if (instance.storageMigration.active())
    return Response.json({ error: 'storage migration is in progress — uploads are temporarily paused' }, { status: 423 })
  const identity = await instance.requireIdentity(request.headers)
  const release = uploadRequests.enter(identity.id)
  if (!release) return Response.json({ error: 'too many concurrent upload requests' }, { status: 429 })
  let releaseOwner: (() => void) | undefined
  try {
    releaseOwner = enterOwnerUpload(identity.id)
  } catch (error) {
    release()
    return error instanceof Response ? error : Response.json({ error: 'upload rejected' }, { status: 500 })
  }
  requestIdentities.set(request, identity)
  const uploadId = request.method === 'POST' ? undefined : uploadIdFromRequest(request)
  try {
    const handle = async () => {
      if (uploadId) requestUploadLocks.set(request, uploadId)
      try {
        const response = await server.handleWeb(request)
        if (uploadId && request.method === 'DELETE' && response.status === 204) {
          instance.repository.deleteUploadSession(uploadId, identity.id)
        }
        return response
      } finally {
        requestUploadLocks.delete(request)
        await rollbackFailedUploadCreation(request, instance.repository)
      }
    }
    return uploadId ? await withUploadLock(uploadId, handle) : await handle()
  } finally {
    requestIdentities.delete(request)
    releaseOwner()
    release()
  }
}

function uploadIdFromRequest(request: Request) {
  const uploadId = new URL(request.url).pathname.split('/').at(-1)
  return uploadId && /^[a-z0-9-]{10,64}$/i.test(uploadId) ? uploadId : undefined
}

export async function cleanExpiredTusUploads(
  repository?: Repository,
  removeStagedUpload: (uploadId: string) => Promise<void> = async () => undefined,
) {
  await fs.promises.mkdir(store.directory, { recursive: true })
  const now = Date.now()
  const entries = await fs.promises.readdir(store.directory)
  const uploadIds = new Set([
    ...(repository?.expiredUploadIds(now) ?? []),
    ...entries.map((entry) => entry.replace(/\.json$/, '')).filter((entry) => /^[a-z0-9-]{10,64}$/i.test(entry)),
  ])
  const removed = await Promise.all(
    [...uploadIds].map((uploadId) =>
      withUploadLock(uploadId, async () => {
        if (repository) {
          const status = repository.uploadSessionStatus(uploadId, now)
          if (status === 'active') return 0
          if (status === 'expired') {
            await Promise.all([tusUploads.remove(uploadId), removeStagedUpload(uploadId)])
            return repository.deleteExpiredUploadSession(uploadId, now) ? 1 : 0
          }
        }
        const upload = await store.configstore.get(uploadId)
        const dataPath = path.join(store.directory, uploadId)
        const createdAt = upload?.creation_date
          ? new Date(upload.creation_date).getTime()
          : (await fs.promises.stat(dataPath).catch(() => undefined))?.mtimeMs
        if (!createdAt || now - createdAt <= UPLOAD_TTL) return 0
        await tusUploads.remove(uploadId)
        return 1
      }),
    ),
  )
  return removed.reduce<number>((total, count) => total + count, 0)
}
