import Database from 'better-sqlite3'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { SqliteRepository } from '../adapters/sqlite'
import type { AssetStore, RecoveryConfig, StorageConfig } from '../core/types'
import { filesystemCapacity } from './operations'
import { recoveryFailures, recoveryMetrics } from './metrics'
import { encryptBackupDirectory, materializeBackupDirectory, recoveryEncryptionConfigured } from './recoveryArchive'

const SETTING = 'recovery'
const CHECK_INTERVAL_MS = 60_000

export const defaultRecoveryConfig: RecoveryConfig = {
  enabled: false,
  directory: process.env.BACKUP_DIR ?? '/backups',
  intervalHours: 24,
  retentionCount: 14,
  integrityIntervalHours: 24,
  minimumFreeBytes: 1024 ** 3,
}

type AssetManifest = { path: string; sizeBytes: number; sha256: string }
type BackupManifest = {
  format: 1
  createdAt: string
  database: { file: string; sizeBytes: number; sha256: string; integrity: string }
  integrationKey?: { file: string; sizeBytes: number; sha256: string }
  assets: AssetManifest[]
  storage: StorageConfig['adapter']
}

type RecoveryStatus = {
  running: boolean
  lastBackupAt?: number
  lastBackupPath?: string
  lastBackupError?: string
  lastIntegrityAt?: number
  lastIntegrity?: string
  backupDestinationFreeBytes?: number
  backupDestinationSeparateDevice?: boolean
  encryptionConfigured: boolean
}

function checksum(file: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(file)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

function safeAssetPath(relativePath: string) {
  const normalized = path.posix.normalize(relativePath).replace(/^\/+/, '')
  if (normalized.startsWith('../') || normalized === '..') throw new Error(`unsafe asset path in backup: ${relativePath}`)
  return normalized
}

function backupName(date = new Date()) {
  return `printhub-backup-${date.toISOString().replaceAll(':', '-')}`
}

function backupDirectories(root: string) {
  if (!fs.existsSync(root)) return []
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('printhub-backup-') && !entry.name.endsWith('.tmp'))
    .map((entry) => path.join(root, entry.name))
    .sort()
}

function syncFile(file: string) {
  const descriptor = fs.openSync(file, 'r')
  try {
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
}

function syncDirectory(directory: string) {
  const descriptor = fs.openSync(directory, 'r')
  try {
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
}

function syncTree(directory: string) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) syncTree(target)
    else if (entry.isFile()) syncFile(target)
  }
  syncDirectory(directory)
}

async function writeAsset(assets: AssetStore, relativePath: string, destination: string) {
  const source = await assets.read(relativePath)
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  await pipeline(
    Readable.fromWeb(source.stream as import('node:stream/web').ReadableStream),
    fs.createWriteStream(destination, { mode: 0o600 }),
  )
  return { path: relativePath, sizeBytes: source.size, sha256: await checksum(destination) }
}

function referencedAssets(databaseFile: string) {
  const database = new Database(databaseFile, { readonly: true, fileMustExist: true })
  try {
    const rows = database.prepare('SELECT file_path,thumbnail_path,preview_path FROM requests').all() as {
      file_path: string
      thumbnail_path: string | null
      preview_path: string | null
    }[]
    return [
      ...new Set(rows.flatMap((row) => [row.file_path, row.thumbnail_path, row.preview_path]).filter((value): value is string => !!value)),
    ]
  } finally {
    database.close()
  }
}

export async function verifyBackupBundle(directory: string) {
  const materialized = await materializeBackupDirectory(directory)
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(materialized.directory, 'manifest.json'), 'utf8')) as BackupManifest
    const databaseFile = path.join(materialized.directory, manifest.database.file)
    if ((await checksum(databaseFile)) !== manifest.database.sha256) throw new Error('backup database checksum does not match its manifest')
    const database = new Database(databaseFile, { readonly: true, fileMustExist: true })
    try {
      const integrity = String(database.pragma('integrity_check', { simple: true }))
      if (integrity !== 'ok') throw new Error(`backup integrity check failed: ${integrity}`)
    } finally {
      database.close()
    }
    for (const asset of manifest.assets) {
      const file = path.join(materialized.directory, 'assets', safeAssetPath(asset.path))
      if ((await checksum(file)) !== asset.sha256) throw new Error(`backup asset checksum failed: ${asset.path}`)
    }
    if (manifest.integrationKey) {
      const file = path.join(materialized.directory, manifest.integrationKey.file)
      if ((await checksum(file)) !== manifest.integrationKey.sha256)
        throw new Error('backup integration key checksum does not match its manifest')
    }
    return manifest
  } finally {
    await materialized.cleanup()
  }
}

export class RecoveryManager {
  private timer?: NodeJS.Timeout
  private active?: Promise<string>
  private state: RecoveryStatus = { running: false, encryptionConfigured: recoveryEncryptionConfigured() }

  constructor(
    private repository: SqliteRepository,
    private assets: AssetStore,
    private storage: StorageConfig,
    private dataDirectory: string,
  ) {}

  config() {
    return { ...defaultRecoveryConfig, ...this.repository.getSetting<Partial<RecoveryConfig>>(SETTING) }
  }

  update(config: RecoveryConfig) {
    this.repository.setSetting(SETTING, config)
    return config
  }

  async status() {
    const config = this.config()
    const latest = backupDirectories(config.directory).at(-1)
    if (latest && !this.state.lastBackupPath) {
      this.state.lastBackupPath = latest
      this.state.lastBackupAt = fs.statSync(latest).mtimeMs
    }
    try {
      fs.mkdirSync(config.directory, { recursive: true })
      this.state.backupDestinationFreeBytes = (await filesystemCapacity(config.directory)).freeBytes
      this.state.backupDestinationSeparateDevice = fs.statSync(config.directory).dev !== fs.statSync(this.dataDirectory).dev
      recoveryMetrics.set({ measure: 'backup_destination_free_bytes' }, this.state.backupDestinationFreeBytes)
    } catch {
      this.state.backupDestinationFreeBytes = undefined
      this.state.backupDestinationSeparateDevice = undefined
    }
    return { config, ...this.state }
  }

  start() {
    if (this.timer) return
    void this.tick()
    this.timer = setInterval(() => void this.tick(), CHECK_INTERVAL_MS)
    this.timer.unref()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  async idle() {
    await this.active
  }

  runBackup() {
    if (this.active) return this.active
    this.state.running = true
    this.state.lastBackupError = undefined
    this.active = this.createBundle()
      .then((directory) => {
        this.state.lastBackupAt = Date.now()
        this.state.lastBackupPath = directory
        recoveryMetrics.set({ measure: 'last_backup_seconds' }, this.state.lastBackupAt / 1000)
        return directory
      })
      .catch((error) => {
        this.state.lastBackupError = error instanceof Error ? error.message : String(error)
        recoveryFailures.inc({ operation: 'backup' })
        throw error
      })
      .finally(() => {
        this.state.running = false
        this.active = undefined
      })
    return this.active
  }

  private async tick() {
    const config = this.config()
    const now = Date.now()
    if (!this.state.lastIntegrityAt || now - this.state.lastIntegrityAt >= config.integrityIntervalHours * 3_600_000) {
      try {
        const result = this.repository.integrityCheck()
        this.state.lastIntegrity = result.integrity
        this.state.lastIntegrityAt = result.checkedAt
        recoveryMetrics.set({ measure: 'last_integrity_check_seconds' }, result.checkedAt / 1000)
      } catch (error) {
        this.state.lastIntegrity = error instanceof Error ? error.message : String(error)
        this.state.lastIntegrityAt = now
        recoveryFailures.inc({ operation: 'integrity' })
      }
    }
    if (!config.enabled || this.active) return
    const latestDirectory = backupDirectories(config.directory).at(-1)
    const latest = this.state.lastBackupAt ?? (latestDirectory ? fs.statSync(latestDirectory).mtimeMs : undefined)
    if (!latest || now - latest >= config.intervalHours * 3_600_000) await this.runBackup().catch(() => undefined)
  }

  private async createBundle() {
    const config = this.config()
    fs.mkdirSync(config.directory, { recursive: true })
    const capacity = await filesystemCapacity(config.directory)
    if (capacity.freeBytes < config.minimumFreeBytes) throw new Error('backup destination is below its configured free-space reserve')
    const finalDirectory = path.join(config.directory, backupName())
    const temporaryDirectory = `${finalDirectory}.${crypto.randomUUID()}.tmp`
    fs.mkdirSync(temporaryDirectory, { recursive: true, mode: 0o700 })
    try {
      const databaseFile = path.join(temporaryDirectory, 'printhub.sqlite')
      await this.repository.backup(databaseFile)
      const assetManifest: AssetManifest[] = []
      for (const relativePath of referencedAssets(databaseFile)) {
        const safePath = safeAssetPath(relativePath)
        assetManifest.push(await writeAsset(this.assets, relativePath, path.join(temporaryDirectory, 'assets', safePath)))
      }
      const integrationKeySource = path.join(this.dataDirectory, 'integration-secrets.key')
      let integrationKey: BackupManifest['integrationKey']
      if (fs.existsSync(integrationKeySource)) {
        const destination = path.join(temporaryDirectory, 'integration-secrets.key')
        fs.copyFileSync(integrationKeySource, destination)
        fs.chmodSync(destination, 0o600)
        integrationKey = { file: 'integration-secrets.key', sizeBytes: fs.statSync(destination).size, sha256: await checksum(destination) }
      }
      const manifest: BackupManifest = {
        format: 1,
        createdAt: new Date().toISOString(),
        database: {
          file: 'printhub.sqlite',
          sizeBytes: fs.statSync(databaseFile).size,
          sha256: await checksum(databaseFile),
          integrity: 'ok',
        },
        integrationKey,
        assets: assetManifest,
        storage: this.storage.adapter,
      }
      fs.writeFileSync(path.join(temporaryDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
      await verifyBackupBundle(temporaryDirectory)
      await encryptBackupDirectory(temporaryDirectory)
      await verifyBackupBundle(temporaryDirectory)
      syncTree(temporaryDirectory)
      fs.renameSync(temporaryDirectory, finalDirectory)
      syncDirectory(config.directory)
      const directories = backupDirectories(config.directory)
      for (const old of directories.slice(0, Math.max(0, directories.length - config.retentionCount)))
        fs.rmSync(old, { recursive: true, force: true })
      return finalDirectory
    } catch (error) {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true })
      throw error
    }
  }
}
