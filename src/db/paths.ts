import fs from 'node:fs'
import path from 'node:path'

export function databasePath() {
  const dataDirectory = path.resolve(process.env.DATA_DIR ?? '/data')
  const current = path.join(dataDirectory, 'stlquest.sqlite')
  const legacy = path.join(dataDirectory, 'printhub.sqlite')
  return fs.existsSync(current) || !fs.existsSync(legacy) ? current : legacy
}
