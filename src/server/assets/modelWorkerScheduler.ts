import os from 'node:os'

const WORKER_MEMORY_BUDGET_BYTES = 768 * 1024 * 1024
const SERVER_MEMORY_RESERVE_BYTES = 512 * 1024 * 1024
const MAX_DEFAULT_CONCURRENCY = 4
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000

export class ModelWorkerShutdownError extends Error {
  constructor() {
    super('model worker scheduler is shutting down')
  }
}

type ScheduledWork<Result> = {
  work: (signal: AbortSignal) => Promise<Result>
  resolve: (result: Result) => void
  reject: (error: unknown) => void
}

type RunningWork = {
  controller: AbortController
  reject: (error: unknown) => void
  consumerSettled: boolean
  done: Promise<void>
}

export class ModelWorkerScheduler {
  private queued: ScheduledWork<unknown>[] = []
  private running = new Set<RunningWork>()
  private closing = false
  private reopenWhenDrained = false

  constructor(
    readonly concurrency = defaultModelWorkerConcurrency(),
    private shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  ) {}

  run<Result>(work: (signal: AbortSignal) => Promise<Result>): Promise<Result> {
    if (this.closing) return Promise.reject(new ModelWorkerShutdownError())
    return new Promise<Result>((resolve, reject) => {
      this.queued.push({ work, resolve, reject } as ScheduledWork<unknown>)
      this.startQueuedWork()
    })
  }

  async shutdown() {
    if (!this.closing) {
      this.closing = true
      this.reopenWhenDrained = false
      const error = new ModelWorkerShutdownError()
      for (const queued of this.queued.splice(0)) queued.reject(error)
      for (const running of this.running) {
        if (!running.consumerSettled) {
          running.consumerSettled = true
          running.reject(error)
        }
        running.controller.abort(error)
      }
    }
    if (this.running.size) {
      await Promise.race([
        Promise.allSettled([...this.running].map(({ done }) => done)),
        new Promise<void>((resolve) => setTimeout(resolve, this.shutdownTimeoutMs)),
      ])
    }
    if (this.running.size) this.reopenWhenDrained = true
    else this.closing = false
  }

  stats() {
    return { queued: this.queued.length, running: this.running.size, concurrency: this.concurrency }
  }

  private startQueuedWork() {
    while (!this.closing && this.running.size < this.concurrency) {
      const queued = this.queued.shift()
      if (!queued) return
      const controller = new AbortController()
      const running = {} as RunningWork
      running.controller = controller
      running.reject = queued.reject
      running.consumerSettled = false
      running.done = Promise.resolve()
        .then(() => queued.work(controller.signal))
        .then(
          (result) => {
            if (running.consumerSettled) return
            running.consumerSettled = true
            queued.resolve(result)
          },
          (error) => {
            if (running.consumerSettled) return
            running.consumerSettled = true
            queued.reject(error)
          },
        )
        .finally(() => {
          this.running.delete(running)
          if (this.closing && this.reopenWhenDrained && this.running.size === 0) {
            this.closing = false
            this.reopenWhenDrained = false
          }
          this.startQueuedWork()
        })
      this.running.add(running)
    }
  }
}

export function defaultModelWorkerConcurrency(
  memoryBytes = process.constrainedMemory?.() || os.totalmem(),
  configured = process.env.MODEL_WORKER_CONCURRENCY,
) {
  if (configured !== undefined && configured !== '') {
    const value = Number(configured)
    if (!Number.isInteger(value) || value < 1) throw new Error('MODEL_WORKER_CONCURRENCY must be a positive integer')
    return value
  }
  const available = Math.max(0, memoryBytes - SERVER_MEMORY_RESERVE_BYTES)
  return Math.max(1, Math.min(MAX_DEFAULT_CONCURRENCY, Math.floor(available / WORKER_MEMORY_BUDGET_BYTES)))
}

export const modelWorkerScheduler = new ModelWorkerScheduler()
