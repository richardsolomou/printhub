import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SqliteRepository } from './sqlite'

describe('SqliteRepository contract', () => {
  let repository: SqliteRepository

  beforeEach(() => { repository = new SqliteRepository(new Database(':memory:')) })
  afterEach(() => repository.close())

  it('persists requests and tracks copy quantities transactionally', () => {
    const id = repository.createRequest({
      name: 'Bracket', fileName: 'bracket.stl', filePath: 'todo/bracket.stl', quantity: 3,
      requesterEmail: 'maker@example.com', requesterName: 'Maker', notes: 'PETG', sourceUrl: 'https://example.com/bracket',
    })
    expect(repository.getRequest(id)).toMatchObject({ counts: { todo: 3, in_progress: 0, done: 0 }, sourceUrl: 'https://example.com/bracket' })

    repository.moveCopies({ id, from: 'todo', to: 'in_progress', count: 2, filePath: 'todo/bracket.stl', order: 4 })
    expect(repository.getRequest(id)).toMatchObject({ counts: { todo: 1, in_progress: 2, done: 0 }, orders: { in_progress: 4 } })
    expect(() => repository.moveCopies({ id, from: 'todo', to: 'done', count: 2, filePath: 'todo/bracket.stl' })).toThrow('invalid move')
    expect(repository.getRequest(id)?.counts).toEqual({ todo: 1, in_progress: 2, done: 0 })
  })

  it('enforces quantity invariants and cascades status deletion', () => {
    const id = repository.createRequest({ name: 'Gear', fileName: 'gear.stl', filePath: 'todo/gear.stl', quantity: 2, requesterEmail: 'a@b.test' })
    repository.moveCopies({ id, from: 'todo', to: 'done', count: 1, filePath: 'todo/gear.stl' })
    expect(() => repository.updateRequest(id, { quantity: 0 })).toThrow()
    repository.updateRequest(id, { quantity: 4, notes: 'four please', sourceUrl: 'https://example.com/gear' })
    expect(repository.getRequest(id)).toMatchObject({ quantity: 4, counts: { todo: 3, done: 1 }, notes: 'four please', sourceUrl: 'https://example.com/gear' })
    repository.deleteRequest(id)
    expect(repository.getRequest(id)).toBeUndefined()
  })

  it('stores users and expiring hashed sessions', () => {
    const user = repository.createUser({ email: 'OP@example.com', name: 'Operator', passwordHash: 'hash', role: 'operator' })
    repository.createSession({ tokenHash: 'token', userId: user.id, expiresAt: Date.now() + 1000 })
    expect(repository.findSession('token')).toEqual({ ...user, email: 'op@example.com' })
    expect(repository.passwordHash(user.id)).toBe('hash')
    repository.deleteSession('token')
    expect(repository.findSession('token')).toBeUndefined()
    repository.updatePassword(user.id, 'new-hash')
    expect(repository.passwordHash(user.id)).toBe('new-hash')
  })

  it('rolls back a password rotation when replacement-session insertion fails', () => {
    const user = repository.createUser({ email: 'rotate@example.com', name: 'Rotate', passwordHash: 'old-hash', role: 'operator' })
    repository.createSession({ tokenHash: 'old-session', userId: user.id, expiresAt: Date.now() + 60_000 })
    repository.createSession({ tokenHash: 'duplicate-token', userId: user.id, expiresAt: Date.now() + 60_000 })
    expect(() => repository.rotatePasswordSession({ userId: user.id, expectedPasswordHash: 'old-hash', passwordHash: 'new-hash', tokenHash: 'duplicate-token', expiresAt: Date.now() + 60_000 })).toThrow()
    expect(repository.passwordHash(user.id)).toBe('old-hash')
    expect(repository.findSession('old-session')).toEqual(user)
  })

  it('fences sessions and password rotations against a stale password hash', () => {
    const user = repository.createUser({ email: 'fence@example.com', name: 'Fence', passwordHash: 'old-hash', role: 'operator' })
    expect(repository.rotatePasswordSession({ userId: user.id, expectedPasswordHash: 'old-hash', passwordHash: 'new-hash', tokenHash: 'new-session', expiresAt: Date.now() + 60_000 })).toBe(true)
    expect(repository.createSessionIfPasswordHash({ userId: user.id, expectedPasswordHash: 'old-hash', tokenHash: 'stale-login', expiresAt: Date.now() + 60_000 })).toBe(false)
    expect(repository.rotatePasswordSession({ userId: user.id, expectedPasswordHash: 'old-hash', passwordHash: 'losing-hash', tokenHash: 'losing-session', expiresAt: Date.now() + 60_000 })).toBe(false)
    expect(repository.passwordHash(user.id)).toBe('new-hash')
    expect(repository.findSession('stale-login')).toBeUndefined()
    expect(repository.findSession('losing-session')).toBeUndefined()
  })

  it('persists operation state transitions with the associated metadata commit', () => {
    const id = repository.createRequest({ name: 'Gear', fileName: 'gear.stl', filePath: 'todo/gear.stl', quantity: 1, requesterEmail: 'a@b.test' })
    const operationId = crypto.randomUUID()
    repository.beginOperation(operationId, {
      kind: 'move', requestId: id, fromStatus: 'todo', toStatus: 'done', count: 1,
      sourcePath: 'todo/gear.stl', destinationPath: 'done/gear.stl',
    })
    repository.markOperationAssetsMoved(operationId)
    repository.completeMoveOperation(operationId, { id, from: 'todo', to: 'done', count: 1, filePath: 'done/gear.stl' })
    expect(repository.getRequest(id)).toMatchObject({ counts: { todo: 0, done: 1 }, filePath: 'done/gear.stl' })
    expect(repository.listOperations()).toMatchObject([{ id: operationId, state: 'committed' }])
    repository.finishOperation(operationId)
    expect(repository.listOperations()).toHaveLength(0)
  })

  it('replaces stale ordering when a status is re-entered', () => {
    const id = repository.createRequest({ name: 'Gear', fileName: 'gear.stl', filePath: 'todo/gear.stl', quantity: 1, requesterEmail: 'a@b.test' })
    repository.moveCopies({ id, from: 'todo', to: 'in_progress', count: 1, filePath: 'in-progress/gear.stl', order: 4 })
    repository.moveCopies({ id, from: 'in_progress', to: 'todo', count: 1, filePath: 'todo/gear.stl', order: 2 })
    repository.moveCopies({ id, from: 'todo', to: 'in_progress', count: 1, filePath: 'in-progress/gear.stl', order: 9 })
    expect(repository.getRequest(id)?.orders).toMatchObject({ todo: undefined, in_progress: 9 })
  })

  it('atomically allows only one first operator', () => {
    expect(repository.createFirstUser({ email: 'one@example.com', name: 'One', passwordHash: 'hash' }).role).toBe('operator')
    expect(() => repository.createFirstUser({ email: 'two@example.com', name: 'Two', passwordHash: 'hash' })).toThrow()
    expect(repository.countUsers()).toBe(1)
  })

  it('reconciles added statuses and rejects removed statuses that contain copies', () => {
    const id = repository.createRequest({ name: 'Gear', fileName: 'gear.stl', filePath: 'todo/gear.stl', quantity: 1, requesterEmail: 'a@b.test' })
    const raw = (repository as unknown as { db: Database.Database }).db
    raw.prepare("DELETE FROM request_statuses WHERE request_id=? AND status_id='done'").run(id)
    repository.reconcileWorkflow()
    expect(repository.getRequest(id)?.counts.done).toBe(0)
    raw.prepare("INSERT INTO request_statuses VALUES (?, 'retired', 1, NULL)").run(id)
    expect(() => repository.reconcileWorkflow()).toThrow('still has copies')
  })

  it('persists incomplete-upload ownership, quotas, and completion receipts', () => {
    const expires = Date.now() + 60_000
    expect(repository.createUploadSession('persisted-upload-id', 'owner', expires, 3)).toEqual({ fresh: true })
    expect(repository.reserveUpload('persisted-upload-id', 'owner', 60, expires, { count: 2, bytes: 100 })).toBe(true)
    repository.createUploadSession('second-upload-id', 'owner', expires, 3)
    expect(repository.reserveUpload('second-upload-id', 'owner', 41, expires, { count: 2, bytes: 100 })).toBe(false)
    expect(() => repository.createUploadSession('persisted-upload-id', 'attacker', expires, 3)).toThrow(expect.objectContaining({ status: 409 }))
  })

  it('atomically reserves a request against overlapping durable operations', () => {
    const id = repository.createRequest({ name: 'Gear', fileName: 'gear.stl', filePath: 'todo/gear.stl', quantity: 1, requesterEmail: 'a@b.test' })
    repository.beginOperation(crypto.randomUUID(), {
      kind: 'move', requestId: id, fromStatus: 'todo', toStatus: 'done', count: 1,
      sourcePath: 'todo/gear.stl', destinationPath: 'done/gear.stl',
    })
    expect(() => repository.beginOperation(crypto.randomUUID(), { kind: 'delete', requestId: id, assets: [] }))
      .toThrow(expect.objectContaining({ status: 409 }))
    expect(() => repository.updateRequest(id, { quantity: 2 })).toThrow(expect.objectContaining({ status: 409 }))
    expect(repository.getRequest(id)).toMatchObject({ quantity: 1, filePath: 'todo/gear.stl' })
  })

  it('does not persist a newly rejected upload session', () => {
    const expires = Date.now() + 60_000
    for (const id of ['quota-upload-one', 'quota-upload-two', 'quota-upload-three']) {
      expect(repository.createUploadSession(id, 'owner', expires, 3)).toEqual({ fresh: true })
    }
    expect(() => repository.createUploadSession('quota-upload-four', 'owner', expires, 3)).toThrow(expect.objectContaining({ status: 429 }))
    const raw = (repository as unknown as { db: Database.Database }).db
    expect((raw.prepare('SELECT count(*) count FROM upload_sessions WHERE owner_id=?').get('owner') as { count: number }).count).toBe(3)
    repository.expireUploads(expires + 1)
    expect(repository.createUploadSession('quota-upload-four', 'owner', expires + 60_000, 3)).toEqual({ fresh: true })
  })

  it('enforces incomplete-upload quotas after reopening the database', async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-sqlite-'))
    const file = path.join(directory, 'test.sqlite')
    const expires = Date.now() + 60_000
    const first = SqliteRepository.open(file)
    first.createUploadSession('restart-upload-one', 'owner', expires, 3)
    expect(first.reserveUpload('restart-upload-one', 'owner', 70, expires, { count: 2, bytes: 100 })).toBe(true)
    first.createUploadSession('restart-upload-two', 'owner', expires, 2)
    expect(() => first.createUploadSession('restart-upload-rejected', 'owner', expires, 2)).toThrow(expect.objectContaining({ status: 429 }))
    first.close()
    const reopened = SqliteRepository.open(file)
    expect(reopened.reserveUpload('restart-upload-two', 'owner', 31, expires, { count: 2, bytes: 100 })).toBe(false)
    expect(reopened.createUploadSession('restart-upload-one', 'owner', expires, 2)).toEqual({ fresh: false })
    expect(() => reopened.createUploadSession('restart-upload-rejected', 'owner', expires, 2)).toThrow(expect.objectContaining({ status: 429 }))
    reopened.close()
    await fs.promises.rm(directory, { recursive: true, force: true })
  })
})
