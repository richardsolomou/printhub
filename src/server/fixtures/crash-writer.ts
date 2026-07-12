import Database from 'better-sqlite3'
import path from 'node:path'
import { acquireDataDirectoryLease } from '../dataSafety'

const directory = process.argv[2]
const lease = acquireDataDirectoryLease(directory)
const database = new Database(path.join(directory, 'crash.sqlite'))
database.pragma('journal_mode = WAL')
database.pragma('synchronous = FULL')
database.exec('CREATE TABLE probes (value TEXT NOT NULL)')
database.prepare('INSERT INTO probes VALUES (?)').run('Crash-safe probe')
process.stdout.write('ready\n')
setInterval(() => void lease, 60_000)
