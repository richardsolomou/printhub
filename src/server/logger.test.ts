import { afterEach, describe, expect, it, vi } from 'vitest'
import { logger, setTelemetryExporters } from './logger'

const originalLevel = logger.level

afterEach(() => {
  logger.level = originalLevel
  setTelemetryExporters(undefined)
})

describe('server logger telemetry', () => {
  it('forwards logged errors to error tracking', () => {
    const exception = vi.fn()
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    logger.level = 'error'
    setTelemetryExporters({ exception, log: vi.fn() })
    const failure = new Error('database unavailable')

    logger.error({ err: failure }, 'request failed')

    expect(exception).toHaveBeenCalledWith(failure)
    output.mockRestore()
  })

  it('forwards redacted structured records to log export', () => {
    const log = vi.fn()
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    logger.level = 'error'
    setTelemetryExporters({ exception: vi.fn(), log })

    logger.error({ password: 'secret', requestId: 'request-id' }, 'request failed')

    expect(log).toHaveBeenCalledWith(expect.objectContaining({ password: '[Redacted]', requestId: 'request-id', msg: 'request failed' }))
    output.mockRestore()
  })
})
