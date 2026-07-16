import { describe, expect, it, vi } from 'vitest'
import { defaultModelWorkerConcurrency, ModelWorkerScheduler, ModelWorkerShutdownError } from './modelWorkerScheduler'

describe('model worker scheduler', () => {
  it('uses a bounded memory-aware default', () => {
    expect(defaultModelWorkerConcurrency(1024 * 1024 * 1024)).toBe(1)
    expect(defaultModelWorkerConcurrency(2 * 1024 * 1024 * 1024)).toBe(2)
    expect(defaultModelWorkerConcurrency(128 * 1024 * 1024 * 1024)).toBe(4)
    expect(defaultModelWorkerConcurrency(2 * 1024 * 1024 * 1024, '')).toBe(2)
  })

  it('honors an explicit positive concurrency', () => {
    expect(defaultModelWorkerConcurrency(1024, '6')).toBe(6)
    expect(() => defaultModelWorkerConcurrency(1024, '0')).toThrow('positive integer')
  })

  it('shares one concurrency budget across unrelated work', async () => {
    const scheduler = new ModelWorkerScheduler(1)
    let releaseFirst!: () => void
    const firstReleased = new Promise<void>((resolve) => (releaseFirst = resolve))
    const order: string[] = []
    const first = scheduler.run(async () => {
      order.push('validation started')
      await firstReleased
      order.push('validation finished')
    })
    const second = scheduler.run(async () => {
      order.push('asset started')
    })

    await Promise.resolve()
    expect(scheduler.stats()).toEqual({ queued: 1, running: 1, concurrency: 1 })
    expect(order).toEqual(['validation started'])
    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual(['validation started', 'validation finished', 'asset started'])
  })

  it('rejects queued work and aborts running work during shutdown', async () => {
    const scheduler = new ModelWorkerScheduler(1)
    let runningSignal!: AbortSignal
    const running = scheduler.run(
      (signal) =>
        new Promise<void>((_resolve, reject) => {
          runningSignal = signal
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
    )
    let queuedStarted = false
    const queued = scheduler.run(async () => {
      queuedStarted = true
    })

    await vi.waitFor(() => expect(runningSignal).toBeDefined())
    await scheduler.shutdown()

    await expect(running).rejects.toBeInstanceOf(ModelWorkerShutdownError)
    await expect(queued).rejects.toBeInstanceOf(ModelWorkerShutdownError)
    expect(queuedStarted).toBe(false)
    expect(scheduler.stats()).toEqual({ queued: 0, running: 0, concurrency: 1 })
  })

  it('completes shutdown at the deadline when work ignores cancellation', async () => {
    vi.useFakeTimers()
    const scheduler = new ModelWorkerScheduler(1, 250)
    let release!: () => void
    const running = scheduler.run(() => new Promise<void>((resolve) => (release = resolve)))
    const runningResult = running.catch((error) => error)
    await Promise.resolve()

    const shutdown = scheduler.shutdown()
    await vi.advanceTimersByTimeAsync(250)

    await expect(shutdown).resolves.toBeUndefined()
    expect(await runningResult).toBeInstanceOf(ModelWorkerShutdownError)
    expect(scheduler.stats()).toEqual({ queued: 0, running: 1, concurrency: 1 })
    await expect(scheduler.run(async () => undefined)).rejects.toBeInstanceOf(ModelWorkerShutdownError)

    release()
    await vi.waitFor(() => expect(scheduler.stats()).toEqual({ queued: 0, running: 0, concurrency: 1 }))
    await expect(scheduler.run(async () => 'reopened')).resolves.toBe('reopened')
    vi.useRealTimers()
  })
})
