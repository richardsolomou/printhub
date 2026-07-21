import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

function databasePaths() {
  const dataDirectory = path.resolve(process.env.DATA_DIR ?? '/data')
  return {
    current: path.join(dataDirectory, 'stlquest.sqlite'),
    legacy: path.join(dataDirectory, 'printhub.sqlite'),
  }
}

export function databasePath() {
  const { current, legacy } = databasePaths()
  return fs.existsSync(current) || !fs.existsSync(legacy) ? current : legacy
}

export function migrateLegacyDatabasePath() {
  const { current, legacy } = databasePaths()
  if (fs.existsSync(current) || !fs.existsSync(legacy)) return current

  const database = new Database(legacy)
  try {
    database.pragma('busy_timeout = 5000')
    const [checkpoint] = database.pragma('wal_checkpoint(TRUNCATE)') as Array<{ busy: number }>
    if (checkpoint?.busy) throw new Error('cannot rename the legacy database while another process is using it')
  } finally {
    database.close()
  }

  fs.renameSync(legacy, current)
  return current
}
