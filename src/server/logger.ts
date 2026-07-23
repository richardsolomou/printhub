import pino from 'pino'
import { currentRequestId } from './requestContext'

type TelemetryExporters = {
  exception: (error: unknown) => void
  log: (record: Record<string, unknown>) => void
}

let telemetryExporters: TelemetryExporters | undefined

export function setTelemetryExporters(exporters: TelemetryExporters | undefined) {
  telemetryExporters = exporters
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  base: { service: 'stlquest' },
  redact: {
    paths: ['password', 'token', 'authorization', 'cookie', '*.password', '*.token', '*.authorization', '*.cookie'],
    censor: '[Redacted]',
  },
  hooks: {
    logMethod(args, method, level) {
      if (level >= 50 && args[0] && typeof args[0] === 'object' && 'err' in args[0]) telemetryExporters?.exception(args[0].err)
      return method.apply(this, args)
    },
    streamWrite(serialized) {
      try {
        telemetryExporters?.log(JSON.parse(serialized) as Record<string, unknown>)
      } catch {}
      return serialized
    },
  },
  mixin: () => {
    const requestId = currentRequestId()
    return requestId ? { requestId } : {}
  },
})
