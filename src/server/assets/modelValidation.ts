import fs from 'node:fs'
import { Worker } from 'node:worker_threads'
import { parseThreeMf, SUPPORTED_THREE_MF_PARSE_OPTIONS } from '../../core/mesh/threeMf'
import { MODEL_WORKER_RESOURCE_LIMITS, resolveWorkerConfig, type WorkerConfig } from './workerConfig'
import { modelWorkerScheduler, type ModelWorkerScheduler } from './modelWorkerScheduler'

const VALIDATION_TIMEOUT_MS = 60_000

export class InvalidThreeMfError extends Error {}

export async function validateThreeMf(
  file: Uint8Array,
  workerConfig: WorkerConfig = resolveWorkerConfig(),
  scheduler: ModelWorkerScheduler = modelWorkerScheduler,
) {
  await scheduler.run((signal) => validateThreeMfBytes(file, workerConfig, signal))
}

export async function validateThreeMfFile(
  path: string,
  workerConfig: WorkerConfig = resolveWorkerConfig(),
  scheduler: ModelWorkerScheduler = modelWorkerScheduler,
) {
  await scheduler.run(async (signal) => {
    const bytes = await fs.promises.readFile(path)
    signal.throwIfAborted()
    await validateThreeMfBytes(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), workerConfig, signal)
  })
}

async function validateThreeMfBytes(file: Uint8Array, workerConfig: WorkerConfig, signal: AbortSignal) {
  signal.throwIfAborted()
  if ('inline' in workerConfig) {
    try {
      parseThreeMf(file, SUPPORTED_THREE_MF_PARSE_OPTIONS)
    } catch (error) {
      throw new InvalidThreeMfError(error instanceof Error ? error.message : String(error), { cause: error })
    }
    return
  }
  await new Promise<void>((resolve, reject) => {
    const worker = new Worker(workerConfig.path, {
      workerData: { file, format: '3mf', mode: 'validate' },
      transferList: [file.buffer as ArrayBuffer],
      execArgv: workerConfig.execArgv ?? [],
      resourceLimits: MODEL_WORKER_RESOURCE_LIMITS,
    })
    let settled = false
    const timer = setTimeout(
      () => void settle(() => reject(new Error('3MF validation exceeded the 60 second limit'))),
      VALIDATION_TIMEOUT_MS,
    )
    const settle = async (action: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        await worker.terminate()
      } catch (error) {
        reject(error)
        return
      }
      action()
    }
    signal.addEventListener('abort', () => void settle(() => reject(signal.reason)), { once: true })
    worker.once('message', (reply: { ok: true } | { ok: false; message: string }) => {
      void settle(() => (reply.ok ? resolve() : reject(new InvalidThreeMfError(reply.message))))
    })
    worker.once('error', (error) => {
      const workerError = error instanceof Error ? error : new Error(String(error))
      const message = /memory limit/i.test(workerError.message) ? '3MF validation exceeded the worker memory limit' : workerError.message
      void settle(() => reject(new Error(message, { cause: workerError })))
    })
    worker.once('exit', (code) => {
      void settle(() => reject(new Error(`3MF validation worker exited with code ${code} before returning a result`)))
    })
  })
}
