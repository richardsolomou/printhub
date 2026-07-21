import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { schema } from './schema'

export type STLQuestDatabase = BetterSQLite3Database<typeof schema> & { $client: Database.Database }

export function createDatabase(source: Database.Database | string): STLQuestDatabase {
  return typeof source === 'string' ? drizzle(source, { schema }) : drizzle({ client: source, schema })
}

export function openDatabase(file: string, options?: Database.Options) {
  return createDatabase(new Database(file, options))
}

export function closeDatabase(database: STLQuestDatabase) {
  database.$client.close()
}

export function databaseFile(database: STLQuestDatabase) {
  return database.$client.name
}
