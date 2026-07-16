import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { FileStore } from '@tus/file-store'
import { eq } from 'drizzle-orm'
import { strToU8, zipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { exportBinaryStl } from '../core/mesh/stl'
import { uploadSessions } from '../db/schema'

function cookies(headers: Headers) {
  return headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')
}

function metadata(values: Record<string, string>) {
  return Object.entries(values)
    .map(([key, value]) => `${key} ${Buffer.from(value).toString('base64')}`)
    .join(',')
}

function threeMfArchive(options: { leafType?: string; containerType?: string; material?: boolean } = {}) {
  const typeAttribute = options.leafType ? ` type="${options.leafType}"` : ''
  const materialAttribute = options.material ? ' pid="2" pindex="0"' : ''
  const container = options.containerType
    ? `<object id="2" type="${options.containerType}"><components><component objectid="1"/></components></object>`
    : ''
  const buildObjectId = options.containerType ? '2' : '1'
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rel0" Target="/3D/model.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
    ),
    '3D/model.model': strToU8(`<?xml version="1.0"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources><object id="1"${typeAttribute}${materialAttribute}><mesh><vertices>
    <vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/>
  </vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>${container}</resources>
  <build><item objectid="${buildObjectId}"/></build>
</model>`),
  })
}

describe('tus upload transport', () => {
  let temporary: string | undefined

  afterEach(async () => {
    delete process.env.DATA_DIR
    const singleton = globalThis as typeof globalThis & { __printhub?: Promise<{ repository: { close(): void } }> }
    const running = singleton.__printhub
    delete singleton.__printhub
    if (running) (await running.catch(() => undefined))?.repository.close()
    vi.restoreAllMocks()
    vi.resetModules()
    if (temporary) await fs.promises.rm(temporary, { recursive: true, force: true })
  })

  it('creates, completes, and safely resumes an authenticated upload', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-tus-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    const prints = path.join(temporary, 'prints')
    const { SqliteRepository } = await import('../adapters/sqlite')
    const repository = SqliteRepository.open(path.join(process.env.DATA_DIR, 'printhub.sqlite'))
    repository.setSetting('storage', { adapter: 'local', root: prints })
    repository.close()

    const { app } = await import('./app')
    const instance = await app()
    const signup = await instance.auth.api.signUpEmail({
      body: { email: 'owner@example.com', password: 'password1234', name: 'Owner' },
      returnHeaders: true,
    })
    const headers = {
      cookie: cookies(signup.headers),
      origin: 'http://print.test',
      'sec-fetch-site': 'same-origin',
      'tus-resumable': '1.0.0',
    }
    const { handleUpload } = await import('./uploads')
    const bytes = exportBinaryStl(new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]), new Uint32Array([0, 1, 2]))

    const random = await handleUpload(new Request('http://print.test/api/upload/random-upload-id', { method: 'HEAD', headers }))
    expect(random.status).toBe(404)
    expect(instance.repository.uploadIdsOwnedBy(instance.repository.listUsers()[0].id)).toHaveLength(0)

    const deferred = await handleUpload(
      new Request('http://print.test/api/upload', {
        method: 'POST',
        headers: {
          ...headers,
          'upload-defer-length': '1',
          'upload-metadata': metadata({
            filename: 'deferred.stl',
            name: 'Deferred',
            quantity: '1',
            requestedPrintType: 'resin',
          }),
        },
      }),
    )
    expect(deferred.status).toBe(400)
    await expect(deferred.text()).resolves.toContain('Deferred upload lengths are not supported')
    expect(instance.repository.uploadIdsOwnedBy(instance.repository.listUsers()[0].id)).toHaveLength(0)

    const createFailure = vi.spyOn(FileStore.prototype, 'create').mockRejectedValueOnce(new Error('datastore unavailable'))
    const rejected = await handleUpload(
      new Request('http://print.test/api/upload', {
        method: 'POST',
        headers: {
          ...headers,
          'upload-length': String(bytes.length),
          'upload-metadata': metadata({
            filename: 'rejected.stl',
            name: 'Rejected',
            quantity: '1',
            requestedPrintType: 'resin',
          }),
        },
      }),
    )
    expect(rejected.status).toBe(500)
    expect(instance.repository.uploadIdsOwnedBy(instance.repository.listUsers()[0].id)).toHaveLength(0)
    createFailure.mockRestore()

    const created = await handleUpload(
      new Request('http://print.test/api/upload', {
        method: 'POST',
        headers: {
          ...headers,
          'upload-length': String(bytes.length),
          'upload-metadata': metadata({
            filename: 'probe.stl',
            name: 'Probe',
            quantity: '1',
            requestedPrintType: 'resin',
          }),
        },
      }),
    )
    expect(created.status).toBe(201)
    const location = created.headers.get('location')
    expect(location).toMatch(/^\/api\/upload\//)

    const completed = await handleUpload(
      new Request(`http://print.test${location}`, {
        method: 'PATCH',
        headers: { ...headers, 'content-type': 'application/offset+octet-stream', 'upload-offset': '0' },
        body: Buffer.from(bytes),
      }),
    )
    expect(completed.status).toBe(204)
    expect(completed.headers.get('x-request-id')).toBeTruthy()
    expect(instance.repository.listRequests()).toMatchObject([
      { name: 'Probe', fileName: 'probe.stl', ownerEmail: 'owner@example.com', ownerName: 'Owner' },
    ])
    await instance.assetQueue.idle()

    const resumed = await handleUpload(new Request(`http://print.test${location}`, { method: 'HEAD', headers }))
    expect(resumed.status).toBe(200)
    expect(resumed.headers.get('upload-offset')).toBe(String(bytes.length))
    expect(instance.repository.listRequests()).toHaveLength(1)
  })

  it('serializes completion before validation and prevents DELETE from racing finalization', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-tus-finalization-lock-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    const { SqliteRepository } = await import('../adapters/sqlite')
    const repository = SqliteRepository.open(path.join(process.env.DATA_DIR, 'printhub.sqlite'))
    repository.setSetting('storage', { adapter: 'local', root: path.join(temporary, 'prints') })
    repository.close()

    const { app } = await import('./app')
    const instance = await app()
    const signup = await instance.auth.api.signUpEmail({
      body: { email: 'owner@example.com', password: 'password1234', name: 'Owner' },
      returnHeaders: true,
    })
    const headers = {
      cookie: cookies(signup.headers),
      origin: 'http://print.test',
      'sec-fetch-site': 'same-origin',
      'tus-resumable': '1.0.0',
    }
    const validation = await import('./assets/modelValidation')
    let validationStarted!: () => void
    const started = new Promise<void>((resolve) => (validationStarted = resolve))
    let releaseValidation!: () => void
    const validationGate = new Promise<void>((resolve) => (releaseValidation = resolve))
    const validate = vi.spyOn(validation, 'validateThreeMfFile').mockImplementation(async () => {
      validationStarted()
      await validationGate
    })
    const { cleanExpiredTusUploads, handleUpload } = await import('./uploads')
    const model = threeMfArchive()
    const created = await handleUpload(
      new Request('http://print.test/api/upload', {
        method: 'POST',
        headers: {
          ...headers,
          'upload-length': String(model.length),
          'upload-metadata': metadata({ filename: 'locked.3mf', name: 'Locked', quantity: '1', requestedPrintType: 'resin' }),
        },
      }),
    )
    const location = created.headers.get('location')!
    const completing = handleUpload(
      new Request(`http://print.test${location}`, {
        method: 'PATCH',
        headers: { ...headers, 'content-type': 'application/offset+octet-stream', 'upload-offset': '0' },
        body: model,
      }),
    )
    await started
    instance.repository.database
      .update(uploadSessions)
      .set({ expiresAt: Date.now() - 1 })
      .where(eq(uploadSessions.id, location.split('/').at(-1)!))
      .run()
    let cleanupFinished = false
    const cleaning = cleanExpiredTusUploads(instance.repository, (uploadId) =>
      instance.staging.remove(instance.staging.uploadPart(uploadId)),
    ).then((count) => {
      cleanupFinished = true
      return count
    })
    const retrying = handleUpload(new Request(`http://print.test${location}`, { method: 'HEAD', headers }))

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(validate).toHaveBeenCalledOnce()
    expect(instance.repository.listRequests()).toHaveLength(0)
    expect(cleanupFinished).toBe(false)
    releaseValidation()
    expect((await completing).status).toBe(204)
    expect((await retrying).status).toBe(200)
    expect(await cleaning).toBe(0)
    expect(validate).toHaveBeenCalledOnce()
    expect(instance.repository.listRequests()).toHaveLength(1)
    validate.mockRestore()

    const bytes = exportBinaryStl(new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]), new Uint32Array([0, 1, 2]))
    const deletable = await handleUpload(
      new Request('http://print.test/api/upload', {
        method: 'POST',
        headers: {
          ...headers,
          'upload-length': String(bytes.length),
          'upload-metadata': metadata({ filename: 'deleted.stl', name: 'Deleted', quantity: '1', requestedPrintType: 'resin' }),
        },
      }),
    )
    const deletableLocation = deletable.headers.get('location')!
    let deleteStarted!: () => void
    const deletingStore = new Promise<void>((resolve) => (deleteStarted = resolve))
    let releaseDelete!: () => void
    const deleteGate = new Promise<void>((resolve) => (releaseDelete = resolve))
    const remove = vi.spyOn(FileStore.prototype, 'remove')
    remove.mockImplementationOnce(async function (this: FileStore, uploadId) {
      deleteStarted()
      await deleteGate
      remove.mockRestore()
      await this.remove(uploadId)
    })

    const deleting = handleUpload(new Request(`http://print.test${deletableLocation}`, { method: 'DELETE', headers }))
    await deletingStore
    const finalizing = handleUpload(
      new Request(`http://print.test${deletableLocation}`, {
        method: 'PATCH',
        headers: { ...headers, 'content-type': 'application/offset+octet-stream', 'upload-offset': '0' },
        body: Buffer.from(bytes),
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(instance.repository.listRequests()).toHaveLength(1)
    releaseDelete()

    expect((await deleting).status).toBe(204)
    expect((await finalizing).status).toBe(404)
    expect(instance.repository.listRequests()).toHaveLength(1)
  })

  it('releases upload reservations on DELETE and expired requests', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-tus-release-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    const { SqliteRepository } = await import('../adapters/sqlite')
    const repository = SqliteRepository.open(path.join(process.env.DATA_DIR, 'printhub.sqlite'))
    repository.setSetting('storage', { adapter: 'local', root: path.join(temporary, 'prints') })
    repository.close()

    const { app } = await import('./app')
    const instance = await app()
    const signup = await instance.auth.api.signUpEmail({
      body: { email: 'owner@example.com', password: 'password1234', name: 'Owner' },
      returnHeaders: true,
    })
    const headers = {
      cookie: cookies(signup.headers),
      origin: 'http://print.test',
      'sec-fetch-site': 'same-origin',
      'tus-resumable': '1.0.0',
    }
    const { handleUpload } = await import('./uploads')
    const createUpload = () =>
      handleUpload(
        new Request('http://print.test/api/upload', {
          method: 'POST',
          headers: {
            ...headers,
            'upload-length': '1024',
            'upload-metadata': metadata({ filename: 'partial.stl', name: 'Partial', quantity: '1', requestedPrintType: 'resin' }),
          },
        }),
      )

    const deleted = await createUpload()
    const deletedLocation = deleted.headers.get('location')!
    expect(instance.repository.incompleteUploadStats(Date.now())).toEqual({ count: 1, bytes: 1024 })
    const terminated = await handleUpload(new Request(`http://print.test${deletedLocation}`, { method: 'DELETE', headers }))
    expect(terminated.status).toBe(204)
    expect(instance.repository.incompleteUploadStats(Date.now())).toEqual({ count: 0, bytes: 0 })

    const expired = await createUpload()
    const expiredLocation = expired.headers.get('location')!
    const expiredId = expiredLocation.split('/').at(-1)!
    const configPath = path.join(process.env.DATA_DIR, 'tus', `${expiredId}.json`)
    const config = JSON.parse(await fs.promises.readFile(configPath, 'utf8'))
    config.creation_date = new Date(Date.now() - 86_400_001).toISOString()
    await fs.promises.writeFile(configPath, JSON.stringify(config))

    const response = await handleUpload(new Request(`http://print.test${expiredLocation}`, { method: 'HEAD', headers }))
    expect(response.status).toBe(410)
    expect(instance.repository.incompleteUploadStats(Date.now())).toEqual({ count: 0, bytes: 0 })
    expect(instance.repository.uploadIdsOwnedBy(instance.repository.listUsers()[0].id)).toEqual([])
  })

  it('rejects cross-user DELETE without removing upload data or its reservation', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-tus-delete-owner-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    const { SqliteRepository } = await import('../adapters/sqlite')
    const repository = SqliteRepository.open(path.join(process.env.DATA_DIR, 'printhub.sqlite'))
    repository.setSetting('storage', { adapter: 'local', root: path.join(temporary, 'prints') })
    repository.close()

    const { app } = await import('./app')
    const instance = await app()
    const owner = await instance.auth.api.signUpEmail({
      body: { email: 'owner@example.com', password: 'password1234', name: 'Owner' },
      returnHeaders: true,
    })
    const { withAuthProvisioning } = await import('./authInvite')
    await withAuthProvisioning(() =>
      instance.auth.api.createUser({
        body: { email: 'other@example.com', password: 'password1234', name: 'Other', role: 'requester' },
        headers: new Headers({ cookie: cookies(owner.headers) }),
      }),
    )
    const other = await instance.auth.api.signInEmail({
      body: { email: 'other@example.com', password: 'password1234' },
      returnHeaders: true,
    })
    const baseHeaders = { origin: 'http://print.test', 'sec-fetch-site': 'same-origin', 'tus-resumable': '1.0.0' }
    const ownerHeaders = { ...baseHeaders, cookie: cookies(owner.headers) }
    const otherHeaders = { ...baseHeaders, cookie: cookies(other.headers) }
    const { handleUpload } = await import('./uploads')
    const created = await handleUpload(
      new Request('http://print.test/api/upload', {
        method: 'POST',
        headers: {
          ...ownerHeaders,
          'upload-length': '1024',
          'upload-metadata': metadata({ filename: 'partial.stl', name: 'Partial', quantity: '1', requestedPrintType: 'resin' }),
        },
      }),
    )
    const location = created.headers.get('location')!
    const uploadId = location.split('/').at(-1)!
    const patched = await handleUpload(
      new Request(`http://print.test${location}`, {
        method: 'PATCH',
        headers: { ...ownerHeaders, 'content-type': 'application/offset+octet-stream', 'upload-offset': '0' },
        body: Buffer.from('partial'),
      }),
    )
    expect(patched.status).toBe(204)

    const rejected = await handleUpload(new Request(`http://print.test${location}`, { method: 'DELETE', headers: otherHeaders }))

    expect(rejected.status).toBe(409)
    expect(instance.repository.incompleteUploadStats(Date.now())).toEqual({ count: 1, bytes: 1024 })
    await expect(fs.promises.readFile(path.join(process.env.DATA_DIR, 'tus', uploadId))).resolves.toEqual(Buffer.from('partial'))
    const resumed = await handleUpload(new Request(`http://print.test${location}`, { method: 'HEAD', headers: ownerHeaders }))
    expect(resumed.status).toBe(200)
    expect(resumed.headers.get('upload-offset')).toBe('7')
  })

  it('accepts 3MF originals and generates server-side viewer assets', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-tus-3mf-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    const prints = path.join(temporary, 'prints')
    const { SqliteRepository } = await import('../adapters/sqlite')
    const repository = SqliteRepository.open(path.join(process.env.DATA_DIR, 'printhub.sqlite'))
    repository.setSetting('storage', { adapter: 'local', root: prints })
    repository.close()

    const { app } = await import('./app')
    const instance = await app()
    const signup = await instance.auth.api.signUpEmail({
      body: { email: 'owner@example.com', password: 'password1234', name: 'Owner' },
      returnHeaders: true,
    })
    const headers = {
      cookie: cookies(signup.headers),
      origin: 'http://print.test',
      'sec-fetch-site': 'same-origin',
      'tus-resumable': '1.0.0',
    }
    const { handleUpload } = await import('./uploads')
    const bytes = threeMfArchive({ containerType: 'surface' })
    const created = await handleUpload(
      new Request('http://print.test/api/upload', {
        method: 'POST',
        headers: {
          ...headers,
          'upload-length': String(bytes.length),
          'upload-metadata': metadata({ filename: 'assembly.3mf', name: 'Assembly', quantity: '1', requestedPrintType: 'resin' }),
        },
      }),
    )
    const location = created.headers.get('location')!
    const completed = await handleUpload(
      new Request(`http://print.test${location}`, {
        method: 'PATCH',
        headers: { ...headers, 'content-type': 'application/offset+octet-stream', 'upload-offset': '0' },
        body: Buffer.from(bytes),
      }),
    )

    expect(completed.status).toBe(204)
    await instance.assetQueue.idle()
    const request = instance.repository.listRequests()[0]
    expect(request).toMatchObject({ fileName: 'assembly.3mf' })
    expect(request.filePath).toMatch(/\.3mf$/)
    expect(request.previewPath).toMatch(/\.stl$/)
    expect(await fs.promises.readFile(path.join(prints, request.filePath))).toEqual(Buffer.from(bytes))
    const identity = instance.repository.listUsers()[0]
    expect(instance.service.listRequests(identity).requests[0]).toMatchObject({
      modelFormat: '3mf',
      hasPreview: true,
    })

    await instance.service.moveCopies({ id: request.id, from: 'todo', to: 'in_progress', count: 1 }, identity)
    const moved = instance.repository.getRequest(request.id)!
    expect(moved.filePath).toMatch(/^in-progress\/.*\.3mf$/)
    expect(await fs.promises.readFile(path.join(prints, moved.filePath))).toEqual(Buffer.from(bytes))

    await instance.service.remove(request.id, identity)
    expect(instance.repository.getRequest(request.id)).toBeUndefined()
    for (const asset of [moved.filePath, request.previewPath!, request.thumbnailPath!]) {
      await expect(fs.promises.stat(path.join(prints, asset))).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it('rejects malformed and oversized 3MF uploads without staged or reserved data', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-tus-invalid-3mf-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    const { SqliteRepository } = await import('../adapters/sqlite')
    const repository = SqliteRepository.open(path.join(process.env.DATA_DIR, 'printhub.sqlite'))
    repository.setSetting('storage', { adapter: 'local', root: path.join(temporary, 'prints') })
    repository.close()

    const { app } = await import('./app')
    const instance = await app()
    const signup = await instance.auth.api.signUpEmail({
      body: { email: 'owner@example.com', password: 'password1234', name: 'Owner' },
      returnHeaders: true,
    })
    const headers = {
      cookie: cookies(signup.headers),
      origin: 'http://print.test',
      'sec-fetch-site': 'same-origin',
      'tus-resumable': '1.0.0',
    }
    const { handleUpload } = await import('./uploads')
    const invalid = Buffer.from('not a zip archive')
    const created = await handleUpload(
      new Request('http://print.test/api/upload', {
        method: 'POST',
        headers: {
          ...headers,
          'upload-length': String(invalid.length),
          'upload-metadata': metadata({ filename: 'broken.3mf', name: 'Broken', quantity: '1', requestedPrintType: 'resin' }),
        },
      }),
    )
    const location = created.headers.get('location')!
    const uploadId = location.split('/').at(-1)!
    const rejected = await handleUpload(
      new Request(`http://print.test${location}`, {
        method: 'PATCH',
        headers: { ...headers, 'content-type': 'application/offset+octet-stream', 'upload-offset': '0' },
        body: invalid,
      }),
    )

    expect(rejected.status).toBe(400)
    expect(await rejected.text()).toContain('invalid 3MF archive')
    expect(instance.repository.listRequests()).toHaveLength(0)
    expect(instance.repository.activeUploadIds(Date.now())).not.toContain(uploadId)
    expect((await fs.promises.readdir(path.join(process.env.DATA_DIR, 'tus'))).filter((name) => name.startsWith(uploadId))).toHaveLength(0)
    expect(await fs.promises.readdir(path.join(process.env.DATA_DIR, 'uploads'))).toHaveLength(0)

    const support = threeMfArchive({ leafType: 'support' })
    const supportCreated = await handleUpload(
      new Request('http://print.test/api/upload', {
        method: 'POST',
        headers: {
          ...headers,
          'upload-length': String(support.length),
          'upload-metadata': metadata({ filename: 'support.3mf', name: 'Support', quantity: '1', requestedPrintType: 'resin' }),
        },
      }),
    )
    const supportLocation = supportCreated.headers.get('location')!
    const supportRejected = await handleUpload(
      new Request(`http://print.test${supportLocation}`, {
        method: 'PATCH',
        headers: { ...headers, 'content-type': 'application/offset+octet-stream', 'upload-offset': '0' },
        body: support,
      }),
    )
    expect(supportRejected.status).toBe(400)
    expect(await supportRejected.text()).toContain('object type support')
    expect(instance.repository.listRequests()).toHaveLength(0)

    const material = threeMfArchive({ material: true })
    const materialCreated = await handleUpload(
      new Request('http://print.test/api/upload', {
        method: 'POST',
        headers: {
          ...headers,
          'upload-length': String(material.length),
          'upload-metadata': metadata({ filename: 'material.3mf', name: 'Material', quantity: '1', requestedPrintType: 'resin' }),
        },
      }),
    )
    const materialLocation = materialCreated.headers.get('location')!
    const materialRejected = await handleUpload(
      new Request(`http://print.test${materialLocation}`, {
        method: 'PATCH',
        headers: { ...headers, 'content-type': 'application/offset+octet-stream', 'upload-offset': '0' },
        body: material,
      }),
    )
    expect(materialRejected.status).toBe(400)
    expect(await materialRejected.text()).toContain('core material assignments')
    expect(instance.repository.listRequests()).toHaveLength(0)

    const oversized = await handleUpload(
      new Request('http://print.test/api/upload', {
        method: 'POST',
        headers: {
          ...headers,
          'upload-length': String(128 * 1024 * 1024 + 1),
          'upload-metadata': metadata({ filename: 'huge.3mf', name: 'Huge', quantity: '1', requestedPrintType: 'resin' }),
        },
      }),
    )
    expect(oversized.status).toBe(413)
    expect(await oversized.text()).toContain('128 MiB')
    expect(instance.repository.activeUploadIds(Date.now())).toHaveLength(0)
  })

  it('retains the upload session when rejected-file cleanup fails', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-tus-cleanup-failure-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    const { SqliteRepository } = await import('../adapters/sqlite')
    const repository = SqliteRepository.open(path.join(process.env.DATA_DIR, 'printhub.sqlite'))
    repository.setSetting('storage', { adapter: 'local', root: path.join(temporary, 'prints') })
    repository.close()

    const { app } = await import('./app')
    const instance = await app()
    const signup = await instance.auth.api.signUpEmail({
      body: { email: 'owner@example.com', password: 'password1234', name: 'Owner' },
      returnHeaders: true,
    })
    const headers = {
      cookie: cookies(signup.headers),
      origin: 'http://print.test',
      'sec-fetch-site': 'same-origin',
      'tus-resumable': '1.0.0',
    }
    const { handleUpload } = await import('./uploads')
    const invalid = Buffer.from('not a zip archive')
    const created = await handleUpload(
      new Request('http://print.test/api/upload', {
        method: 'POST',
        headers: {
          ...headers,
          'upload-length': String(invalid.length),
          'upload-metadata': metadata({ filename: 'broken.3mf', name: 'Broken', quantity: '1', requestedPrintType: 'resin' }),
        },
      }),
    )
    const location = created.headers.get('location')!
    const uploadId = location.split('/').at(-1)!
    vi.spyOn(instance.staging, 'remove').mockRejectedValueOnce(new Error('staging unavailable'))

    const rejected = await handleUpload(
      new Request(`http://print.test${location}`, {
        method: 'PATCH',
        headers: { ...headers, 'content-type': 'application/offset+octet-stream', 'upload-offset': '0' },
        body: invalid,
      }),
    )

    expect(rejected.status).toBe(500)
    expect(await rejected.text()).toContain('cleanup will retry after expiry')
    expect(instance.repository.activeUploadIds(Date.now())).toContain(uploadId)
  })

  it('preserves completed 3MF uploads when validation infrastructure fails', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-tus-validation-infra-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    const { SqliteRepository } = await import('../adapters/sqlite')
    const repository = SqliteRepository.open(path.join(process.env.DATA_DIR, 'printhub.sqlite'))
    repository.setSetting('storage', { adapter: 'local', root: path.join(temporary, 'prints') })
    repository.close()

    const { app } = await import('./app')
    const instance = await app()
    const signup = await instance.auth.api.signUpEmail({
      body: { email: 'owner@example.com', password: 'password1234', name: 'Owner' },
      returnHeaders: true,
    })
    const headers = {
      cookie: cookies(signup.headers),
      origin: 'http://print.test',
      'sec-fetch-site': 'same-origin',
      'tus-resumable': '1.0.0',
    }
    const validation = await import('./assets/modelValidation')
    vi.spyOn(validation, 'validateThreeMfFile').mockRejectedValueOnce(new Error('worker unavailable'))
    const { handleUpload } = await import('./uploads')
    const bytes = threeMfArchive()
    const created = await handleUpload(
      new Request('http://print.test/api/upload', {
        method: 'POST',
        headers: {
          ...headers,
          'upload-length': String(bytes.length),
          'upload-metadata': metadata({ filename: 'retry.3mf', name: 'Retry', quantity: '1', requestedPrintType: 'resin' }),
        },
      }),
    )
    const location = created.headers.get('location')!
    const uploadId = location.split('/').at(-1)!

    const failed = await handleUpload(
      new Request(`http://print.test${location}`, {
        method: 'PATCH',
        headers: { ...headers, 'content-type': 'application/offset+octet-stream', 'upload-offset': '0' },
        body: bytes,
      }),
    )

    expect(failed.status).toBe(500)
    expect(instance.repository.activeUploadIds(Date.now())).toContain(uploadId)
    expect((await fs.promises.readdir(path.join(process.env.DATA_DIR, 'tus'))).some((name) => name.startsWith(uploadId))).toBe(true)
  })

  it('cleans stale completed TUS config even when its data file is already missing', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-tus-completed-cleanup-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    const { TusUploadStore, UPLOAD_TTL } = await import('../adapters/tus')
    const uploadId = 'completed-upload-id'
    const uploadStore = new TusUploadStore(process.env.DATA_DIR)
    await fs.promises.mkdir(uploadStore.datastore.directory, { recursive: true })
    await uploadStore.datastore.configstore.set(uploadId, {
      id: uploadId,
      size: 1,
      offset: 1,
      metadata: {},
      creation_date: new Date(Date.now() - UPLOAD_TTL - 1_000).toISOString(),
    } as never)
    const dataOnlyId = 'orphaned-data-id'
    const dataOnlyPath = path.join(uploadStore.datastore.directory, dataOnlyId)
    await fs.promises.writeFile(dataOnlyPath, 'orphaned')
    const old = new Date(Date.now() - UPLOAD_TTL - 1_000)
    await fs.promises.utimes(dataOnlyPath, old, old)
    const { cleanExpiredTusUploads } = await import('./uploads')

    await expect(cleanExpiredTusUploads()).resolves.toBe(2)
    await expect(uploadStore.datastore.configstore.get(uploadId)).resolves.toBeUndefined()
    await expect(fs.promises.stat(dataOnlyPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps expired upload sessions until TUS and staging cleanup both succeed', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-tus-cleanup-retry-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    const { SqliteRepository } = await import('../adapters/sqlite')
    const repository = SqliteRepository.open(path.join(process.env.DATA_DIR, 'printhub.sqlite'))
    repository.setSetting('storage', { adapter: 'local', root: path.join(temporary, 'prints') })
    repository.close()
    const { app } = await import('./app')
    const instance = await app()
    await instance.auth.api.signUpEmail({
      body: { email: 'owner@example.com', password: 'password1234', name: 'Owner' },
    })
    const owner = instance.repository.listUsers()[0]
    const uploadId = 'cleanup-retry-id'
    instance.repository.createUploadSession(uploadId, owner.id, Date.now() - 1, 3)
    instance.repository.reserveUpload(uploadId, owner.id, 7, { count: 3, bytes: 100 })
    const { TusUploadStore } = await import('../adapters/tus')
    const uploadStore = new TusUploadStore(process.env.DATA_DIR)
    await fs.promises.mkdir(uploadStore.datastore.directory, { recursive: true })
    await fs.promises.writeFile(path.join(uploadStore.datastore.directory, uploadId), 'partial')
    await uploadStore.datastore.configstore.set(uploadId, {
      id: uploadId,
      size: 7,
      offset: 7,
      metadata: {},
      creation_date: new Date(Date.now() - 86_400_001).toISOString(),
    } as never)
    const staged = instance.staging.uploadPart(uploadId)
    await fs.promises.mkdir(path.dirname(staged), { recursive: true })
    await fs.promises.writeFile(staged, 'staged')
    const remove = vi.spyOn(instance.staging, 'remove').mockRejectedValueOnce(new Error('staging unavailable'))
    const { cleanExpiredTusUploads } = await import('./uploads')

    await expect(
      cleanExpiredTusUploads(instance.repository, (id) => instance.staging.remove(instance.staging.uploadPart(id))),
    ).rejects.toThrow('staging unavailable')
    expect(instance.repository.uploadIdsOwnedBy(owner.id)).toContain(uploadId)
    remove.mockRestore()

    await expect(
      cleanExpiredTusUploads(instance.repository, (id) => instance.staging.remove(instance.staging.uploadPart(id))),
    ).resolves.toBe(1)
    expect(instance.repository.uploadIdsOwnedBy(owner.id)).not.toContain(uploadId)
    await expect(fs.promises.stat(staged)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('stores the requested print type without accepting a printer assignment', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-tus-mixed-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    const prints = path.join(temporary, 'prints')
    const { SqliteRepository } = await import('../adapters/sqlite')
    const repository = SqliteRepository.open(path.join(process.env.DATA_DIR, 'printhub.sqlite'))
    repository.setSetting('storage', { adapter: 'local', root: prints })
    repository.setSetting('plate-planner-profiles', [
      {
        id: 'resin-printer',
        name: 'Resin printer',
        printType: 'resin',
        enabled: true,
        widthMm: 100,
        depthMm: 60,
        heightMm: 150,
        spacingMm: 2,
        supportMarginMm: 2,
        adhesionMarginMm: 1,
        heightAllowanceMm: 4,
        maxHeightDifferenceMm: 20,
      },
      {
        id: 'filament-printer',
        name: 'Filament printer',
        printType: 'filament',
        enabled: true,
        widthMm: 220,
        depthMm: 220,
        heightMm: 250,
        spacingMm: 3,
        brimMarginMm: 2,
        filamentDiameterMm: 1.75,
        materialDensityGPerCm3: 1.24,
      },
    ])
    repository.close()

    const { app } = await import('./app')
    const instance = await app()
    const signup = await instance.auth.api.signUpEmail({
      body: { email: 'owner@example.com', password: 'password1234', name: 'Owner' },
      returnHeaders: true,
    })
    const headers = {
      cookie: cookies(signup.headers),
      origin: 'http://print.test',
      'sec-fetch-site': 'same-origin',
      'tus-resumable': '1.0.0',
    }
    const { handleUpload } = await import('./uploads')
    const bytes = exportBinaryStl(new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]), new Uint32Array([0, 1, 2]))
    const created = await handleUpload(
      new Request('http://print.test/api/upload', {
        method: 'POST',
        headers: {
          ...headers,
          'upload-length': String(bytes.length),
          'upload-metadata': metadata({
            filename: 'filament.stl',
            name: 'Filament model',
            quantity: '1',
            requestedPrintType: 'filament',
            printerId: 'filament-printer',
          }),
        },
      }),
    )
    const location = created.headers.get('location')
    expect(location).toBeTruthy()

    const completed = await handleUpload(
      new Request(`http://print.test${location}`, {
        method: 'PATCH',
        headers: { ...headers, 'content-type': 'application/offset+octet-stream', 'upload-offset': '0' },
        body: Buffer.from(bytes),
      }),
    )

    expect(completed.status).toBe(204)
    expect(instance.repository.listRequests()).toMatchObject([
      { name: 'Filament model', requestedPrintType: 'filament', printerId: undefined },
    ])
    await instance.assetQueue.idle()
  })

  it('removes incomplete TUS data and metadata when the owner account is deleted', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-tus-delete-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    const { SqliteRepository } = await import('../adapters/sqlite')
    const repository = SqliteRepository.open(path.join(process.env.DATA_DIR, 'printhub.sqlite'))
    repository.setSetting('storage', { adapter: 'local', root: path.join(temporary, 'prints') })
    repository.close()

    const { app } = await import('./app')
    const instance = await app()
    const adminSignup = await instance.auth.api.signUpEmail({
      body: { email: 'admin@example.com', password: 'password1234', name: 'Admin' },
      returnHeaders: true,
    })
    const adminHeaders = new Headers({ cookie: cookies(adminSignup.headers) })
    const { withAuthProvisioning } = await import('./authInvite')
    const created = await withAuthProvisioning(() =>
      instance.auth.api.createUser({
        body: { email: 'owner@example.com', password: 'password1234', name: 'Owner', role: 'requester' },
        headers: adminHeaders,
      }),
    )
    const ownerSignin = await instance.auth.api.signInEmail({
      body: { email: 'owner@example.com', password: 'password1234' },
      returnHeaders: true,
    })
    const uploadHeaders = {
      cookie: cookies(ownerSignin.headers),
      origin: 'http://print.test',
      'sec-fetch-site': 'same-origin',
      'tus-resumable': '1.0.0',
    }
    const { handleUpload } = await import('./uploads')
    const createdUpload = await handleUpload(
      new Request('http://print.test/api/upload', {
        method: 'POST',
        headers: {
          ...uploadHeaders,
          'upload-length': '1024',
          'upload-metadata': metadata({
            filename: 'partial.stl',
            name: 'Partial',
            quantity: '1',
            requestedPrintType: 'resin',
          }),
        },
      }),
    )
    const uploadId = createdUpload.headers.get('location')?.split('/').at(-1)
    expect(uploadId).toBeTruthy()
    const tusDirectory = path.join(process.env.DATA_DIR, 'tus')
    expect((await fs.promises.readdir(tusDirectory)).filter((name) => name.startsWith(uploadId!))).not.toHaveLength(0)

    await instance.auth.api.removeUser({ body: { userId: created.user.id }, headers: adminHeaders })

    expect((await fs.promises.readdir(tusDirectory)).filter((name) => name.startsWith(uploadId!))).toHaveLength(0)
    expect(instance.repository.uploadIdsOwnedBy(created.user.id)).toHaveLength(0)
    expect(instance.repository.listUsers()).not.toContainEqual(expect.objectContaining({ id: created.user.id }))
  })

  it('serializes owner deletion with an authenticated upload finalization', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-tus-delete-race-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    const prints = path.join(temporary, 'prints')
    const { SqliteRepository } = await import('../adapters/sqlite')
    const repository = SqliteRepository.open(path.join(process.env.DATA_DIR, 'printhub.sqlite'))
    repository.setSetting('storage', { adapter: 'local', root: prints })
    repository.close()

    const { app } = await import('./app')
    const instance = await app()
    const adminSignup = await instance.auth.api.signUpEmail({
      body: { email: 'admin@example.com', password: 'password1234', name: 'Admin' },
      returnHeaders: true,
    })
    const adminHeaders = new Headers({ cookie: cookies(adminSignup.headers) })
    const { withAuthProvisioning } = await import('./authInvite')
    const created = await withAuthProvisioning(() =>
      instance.auth.api.createUser({
        body: { email: 'owner@example.com', password: 'password1234', name: 'Owner', role: 'requester' },
        headers: adminHeaders,
      }),
    )
    const ownerSignin = await instance.auth.api.signInEmail({
      body: { email: 'owner@example.com', password: 'password1234' },
      returnHeaders: true,
    })
    const uploadHeaders = {
      cookie: cookies(ownerSignin.headers),
      origin: 'http://print.test',
      'sec-fetch-site': 'same-origin',
      'tus-resumable': '1.0.0',
    }
    const { handleUpload } = await import('./uploads')
    const bytes = exportBinaryStl(new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]), new Uint32Array([0, 1, 2]))
    const upload = await handleUpload(
      new Request('http://print.test/api/upload', {
        method: 'POST',
        headers: {
          ...uploadHeaders,
          'upload-length': String(bytes.length),
          'upload-metadata': metadata({
            filename: 'racing.stl',
            name: 'Racing upload',
            quantity: '1',
            requestedPrintType: 'resin',
          }),
        },
      }),
    )
    const location = upload.headers.get('location')!
    const originalFinalize = instance.service.createUploadedRequest.bind(instance.service)
    let releaseFinalize!: () => void
    const finalizeReleased = new Promise<void>((resolve) => (releaseFinalize = resolve))
    let markFinalizeStarted!: () => void
    const finalizeStarted = new Promise<void>((resolve) => (markFinalizeStarted = resolve))
    vi.spyOn(instance.service, 'createUploadedRequest').mockImplementation(async (...args) => {
      markFinalizeStarted()
      await finalizeReleased
      return originalFinalize(...args)
    })

    const patch = handleUpload(
      new Request(`http://print.test${location}`, {
        method: 'PATCH',
        headers: { ...uploadHeaders, 'content-type': 'application/offset+octet-stream', 'upload-offset': '0' },
        body: Buffer.from(bytes),
      }),
    )
    await finalizeStarted
    let deletionSettled = false
    const deletion = instance.auth.api
      .removeUser({ body: { userId: created.user.id }, headers: adminHeaders })
      .then(() => (deletionSettled = true))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(deletionSettled).toBe(false)
    vi.spyOn(instance, 'requireIdentity').mockResolvedValue({
      id: created.user.id,
      email: created.user.email,
      name: created.user.name,
      role: 'requester',
    })

    const blockedPost = await handleUpload(
      new Request('http://print.test/api/upload', {
        method: 'POST',
        headers: {
          ...uploadHeaders,
          'upload-length': String(bytes.length),
          'upload-metadata': metadata({
            filename: 'too-late.stl',
            name: 'Too late',
            quantity: '1',
            requestedPrintType: 'resin',
          }),
        },
      }),
    )
    expect(blockedPost.status).toBe(410)
    expect(blockedPost.headers.get('location')).toBeNull()

    releaseFinalize()
    expect((await patch).status).toBe(204)
    await deletion
    await instance.assetQueue.idle()

    expect(instance.repository.listRequests()).toHaveLength(0)
    expect(instance.repository.listOperations()).toHaveLength(0)
    expect(instance.repository.uploadIdsOwnedBy(created.user.id)).toHaveLength(0)
    expect(instance.repository.listUsers()).not.toContainEqual(expect.objectContaining({ id: created.user.id }))
    const storedFiles = (await fs.promises.readdir(prints, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
    expect(storedFiles).toEqual([])
  })
})
