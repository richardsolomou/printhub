import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

const NETWORK_FILESYSTEMS = new Map([
  [0x6969, 'NFS'],
  [0x517b, 'SMB'],
  [0xff534d42, 'CIFS'],
])

export function networkFilesystem(dataDirectory: string) {
  const type = fs.statfsSync(dataDirectory).type >>> 0
  return NETWORK_FILESYSTEMS.get(type)
}

export function assertSafeDataFilesystem(dataDirectory: string) {
  const filesystem = networkFilesystem(dataDirectory)
  if (filesystem && process.env.ALLOW_UNSAFE_SQLITE_FILESYSTEM !== 'true')
    throw new Error(
      `SQLite data directory ${dataDirectory} is on ${filesystem}; move /data to local storage or set ALLOW_UNSAFE_SQLITE_FILESYSTEM=true to accept the risk`,
    )
  return filesystem
}

export function acquireDataDirectoryLease(dataDirectory = path.resolve(process.env.DATA_DIR ?? '/data')) {
  fs.mkdirSync(dataDirectory, { recursive: true })
  const file = path.join(dataDirectory, 'printhub.lock')
  const database = new Database(file, { timeout: 0 })
  try {
    database.pragma('journal_mode = DELETE')
    database.pragma('busy_timeout = 0')
    database.exec('CREATE TABLE IF NOT EXISTS lease (id INTEGER PRIMARY KEY CHECK (id = 1))')
    database.exec('BEGIN EXCLUSIVE')
  } catch (error) {
    database.close()
    throw new Error(`another PrintHub process is already using ${dataDirectory}`, { cause: error })
  }
  let released = false
  return {
    file,
    release() {
      if (released) return
      released = true
      database.exec('ROLLBACK')
      database.close()
    },
  }
}
