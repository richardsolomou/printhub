import crypto from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { MigrationMeta } from 'drizzle-orm/migrator'
import type { PrintHubDatabase } from './database'
import journal from './drizzle/meta/_journal.json'

const files = import.meta.glob<string>('./drizzle/*.sql', { eager: true, import: 'default', query: '?raw' })

function bundledMigrations(): MigrationMeta[] {
  return journal.entries.map((entry) => {
    const migration = files[`./drizzle/${entry.tag}.sql`]
    if (!migration) throw new Error(`Drizzle migration ${entry.tag} is missing`)
    return {
      bps: entry.breakpoints,
      folderMillis: entry.when,
      hash: crypto.createHash('sha256').update(migration).digest('hex'),
      sql: migration.split('--> statement-breakpoint'),
    }
  })
}

function seedLegacyBaseline(database: PrintHubDatabase, migrations: MigrationMeta[]) {
  database.run(
    sql.raw(`CREATE TABLE IF NOT EXISTS __drizzle_migrations (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at numeric
  )`),
  )
  const applied = database.get<{ count: number }>(sql`SELECT count(*) count FROM __drizzle_migrations`)
  if ((applied?.count ?? 0) > 0) return
  const baseline = migrations[0]
  if (!baseline) throw new Error('Drizzle baseline migration is missing')
  database.run(sql`INSERT INTO __drizzle_migrations (hash,created_at) VALUES (${baseline.hash},${baseline.folderMillis})`)
}

export function migrateDatabase(database: PrintHubDatabase, migrateLegacy: () => void, beforeMigrate: () => void) {
  const migrations = bundledMigrations()
  const legacy = database.get<{ found: number }>(sql`SELECT 1 found FROM sqlite_master WHERE type='table' AND name='schema_migrations'`)
  const latest = migrations.at(-1)
  const drizzleJournal = database.get<{ found: number }>(
    sql`SELECT 1 found FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'`,
  )
  const applied = drizzleJournal
    ? database.get<{ created_at: number }>(sql`SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1`)
    : undefined
  if (legacy || (latest && (applied?.created_at ?? 0) < latest.folderMillis)) beforeMigrate()
  if (legacy) {
    migrateLegacy()
    seedLegacyBaseline(database, migrations)
    database.run(sql`DROP TABLE schema_migrations`)
  }
  const migrator = database as unknown as {
    dialect: { migrate: (migrations: MigrationMeta[], session: unknown, config: object) => void }
    session: unknown
  }
  migrator.dialect.migrate(migrations, migrator.session, {})
}
