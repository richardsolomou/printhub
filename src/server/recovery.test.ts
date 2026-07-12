import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalAssetStore } from '../adapters/filesystem'
import { SqliteRepository } from '../adapters/sqlite'
import { RecoveryManager, verifyBackupBundle } from './recovery'

describe('recovery manager', () => {
  let root: string
  let data: string
  let prints: string
  let backups: string
  let repository: SqliteRepository
  let assets: LocalAssetStore
  let manager: RecoveryManager

  beforeEach(async () => {
    root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-recovery-'))
    data = path.join(root, 'data')
    prints = path.join(root, 'prints')
    backups = path.join(root, 'backups')
    await fs.promises.mkdir(data)
    repository = SqliteRepository.open(path.join(data, 'printhub.sqlite'))
    assets = new LocalAssetStore(prints)
    await assets.initialize()
    manager = new RecoveryManager(repository, assets, { adapter: 'local', root: prints }, data)
    manager.update({
      enabled: false,
      directory: backups,
      intervalHours: 24,
      retentionCount: 2,
      integrityIntervalHours: 24,
      minimumFreeBytes: 256 * 1024 * 1024,
    })
  })

  afterEach(async () => {
    delete process.env.RECOVERY_ENCRYPTION_KEY
    manager.stop()
    await manager.idle()
    repository.close()
    await fs.promises.rm(root, { recursive: true, force: true })
  })

  it('creates and restores a verified database, key, and asset bundle', async () => {
    const filePath = 'todo/probe.stl'
    await assets.write(filePath, new TextEncoder().encode('solid probe'))
    await fs.promises.writeFile(path.join(data, 'integration-secrets.key'), 'backup-key', { mode: 0o600 })
    const id = repository.createRequest({
      name: 'Backup probe',
      fileName: 'probe.stl',
      filePath,
      quantity: 1,
      requesterEmail: 'maker@example.com',
    })

    const directory = await manager.runBackup()
    const manifest = await verifyBackupBundle(directory)
    expect(manifest.assets).toEqual([expect.objectContaining({ path: filePath, sizeBytes: 11 })])
    expect(await fs.promises.readFile(path.join(directory, 'assets', filePath), 'utf8')).toBe('solid probe')
    expect(await fs.promises.readFile(path.join(directory, 'integration-secrets.key'), 'utf8')).toBe('backup-key')

    await fs.promises.copyFile(path.join(directory, 'printhub.sqlite'), path.join(root, 'restored.sqlite'))
    const copy = SqliteRepository.open(path.join(root, 'restored.sqlite'))
    try {
      expect(copy.integrityCheck()).toMatchObject({ integrity: 'ok' })
      expect(copy.getRequest(id)).toMatchObject({ name: 'Backup probe', filePath })
    } finally {
      copy.close()
    }
  })

  it('detects tampered assets and applies retention', async () => {
    const filePath = 'todo/probe.stl'
    await assets.write(filePath, new TextEncoder().encode('solid probe'))
    repository.createRequest({ name: 'Probe', fileName: 'probe.stl', filePath, quantity: 1, requesterEmail: 'maker@example.com' })
    const first = await manager.runBackup()
    await new Promise((resolve) => setTimeout(resolve, 5))
    await manager.runBackup()
    await new Promise((resolve) => setTimeout(resolve, 5))
    const third = await manager.runBackup()
    expect((await fs.promises.readdir(backups)).filter((entry) => entry.startsWith('printhub-backup-'))).toHaveLength(2)
    await expect(fs.promises.stat(first)).rejects.toMatchObject({ code: 'ENOENT' })
    await fs.promises.writeFile(path.join(third, 'assets', filePath), 'tampered')
    await expect(verifyBackupBundle(third)).rejects.toThrow(`backup asset checksum failed: ${filePath}`)
  })

  it('encrypts bundles and verifies them only with the deployment key', async () => {
    process.env.RECOVERY_ENCRYPTION_KEY = '11'.repeat(32)
    manager = new RecoveryManager(repository, assets, { adapter: 'local', root: prints }, data)
    manager.update({
      enabled: false,
      directory: backups,
      intervalHours: 24,
      retentionCount: 2,
      integrityIntervalHours: 24,
      minimumFreeBytes: 256 * 1024 * 1024,
    })
    const directory = await manager.runBackup()
    expect(await fs.promises.readdir(directory)).toEqual(expect.arrayContaining(['bundle.tar.enc', 'envelope.json']))
    await expect(verifyBackupBundle(directory)).resolves.toMatchObject({ format: 1 })
    delete process.env.RECOVERY_ENCRYPTION_KEY
    await expect(verifyBackupBundle(directory)).rejects.toThrow('RECOVERY_ENCRYPTION_KEY is required')
  })
})
