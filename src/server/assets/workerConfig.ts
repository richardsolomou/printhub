import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

export type WorkerConfig = { path: string; execArgv?: string[] } | { inline: true }

export const MODEL_WORKER_RESOURCE_LIMITS = {
  maxYoungGenerationSizeMb: 64,
  maxOldGenerationSizeMb: 512,
  stackSizeMb: 8,
} as const

export const MODEL_ASSET_WORKER_TIMEOUT_MS = 120_000

export function resolveWorkerConfig(
  options: { vitest?: boolean; dev?: boolean; prod?: boolean; candidates?: string[] } = {},
): WorkerConfig {
  const vitest = options.vitest ?? Boolean(process.env.VITEST)
  const dev = options.dev ?? import.meta.env?.DEV
  const prod = options.prod ?? import.meta.env?.PROD
  if (vitest) return { inline: true }
  if (dev) return { path: fileURLToPath(new URL('./worker.ts', import.meta.url)), execArgv: ['--import', 'tsx'] }
  if (!prod) return { inline: true }
  for (const candidate of options.candidates ?? ['../assets-worker.mjs', './assets-worker.mjs', '../../assets-worker.mjs']) {
    try {
      const resolved = fileURLToPath(new URL(candidate, import.meta.url))
      if (fs.existsSync(resolved)) return { path: resolved }
    } catch {}
  }
  throw new Error('assets worker is required in production but was not found next to the server bundle')
}
