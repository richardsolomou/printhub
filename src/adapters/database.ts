import Database from 'better-sqlite3'
import { sql, type SQL } from 'drizzle-orm'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { schema } from './schema'

export type PrintHubDatabase = BetterSQLite3Database<typeof schema> &
  Pick<Database.Database, 'exec' | 'pragma' | 'prepare'> & { $client: Database.Database }

export function createDatabase(client: Database.Database): PrintHubDatabase {
  return Object.assign(drizzle({ client, schema }), {
    exec: client.exec.bind(client),
    pragma: client.pragma.bind(client),
    prepare: client.prepare.bind(client),
  })
}

function bindSql(query: string, parameters: unknown[]): SQL {
  const parts = query.split('?')
  if (parts.length !== parameters.length + 1) throw new Error('SQL parameter count does not match placeholders')
  const chunks: SQL[] = []
  for (const [index, part] of parts.entries()) {
    chunks.push(sql.raw(part))
    if (index < parameters.length) chunks.push(sql`${parameters[index]}`)
  }
  return sql.join(chunks)
}

type DrizzleStatement = {
  all<T = unknown>(...parameters: unknown[]): T[]
  get<T = unknown>(...parameters: unknown[]): T | undefined
  run(...parameters: unknown[]): Database.RunResult
}

export type DrizzleQueries = {
  prepare(query: string): DrizzleStatement
  transaction<T>(callback: () => T): T
}

function execute<T>(operation: () => T): T {
  try {
    return operation()
  } catch (error) {
    if (error instanceof Error && 'cause' in error && error.cause instanceof Error) throw error.cause
    throw error
  }
}

export function createQueries(database: PrintHubDatabase): DrizzleQueries {
  return {
    prepare: (query) => ({
      all: <T>(...parameters: unknown[]) => execute(() => database.all<T>(bindSql(query, parameters))),
      get: <T>(...parameters: unknown[]) => execute(() => database.get<T>(bindSql(query, parameters))),
      run: (...parameters) => execute(() => database.run(bindSql(query, parameters))),
    }),
    transaction: (callback) => database.transaction(callback),
  }
}
