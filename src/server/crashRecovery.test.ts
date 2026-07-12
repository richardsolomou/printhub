import { spawn } from 'node:child_process'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { acquireDataDirectoryLease } from './dataSafety'

const childScript = fileURLToPath(new URL('./fixtures/crash-writer.ts', import.meta.url))

describe('process crash recovery', () => {
  let temporary: string | undefined

  afterEach(async () => {
    if (temporary) await fs.promises.rm(temporary, { recursive: true, force: true })
  })

  it('releases the process lease and preserves committed WAL data after SIGKILL', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-crash-'))
    const child = spawn(process.execPath, ['--import', 'tsx', childScript, temporary], { stdio: ['ignore', 'pipe', 'inherit'] })
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject)
      child.stdout.once('data', () => resolve())
    })
    child.kill('SIGKILL')
    await new Promise((resolve) => child.once('exit', resolve))

    const lease = acquireDataDirectoryLease(temporary)
    lease.release()
    const database = new Database(path.join(temporary, 'crash.sqlite'))
    try {
      expect(database.pragma('integrity_check', { simple: true })).toBe('ok')
      expect(database.prepare('SELECT value FROM probes').get()).toEqual({ value: 'Crash-safe probe' })
    } finally {
      database.close()
    }
  })
})
