import pino from 'pino'
import { currentRequestId } from './requestContext'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  base: { service: 'printhub' },
  mixin: () => {
    const requestId = currentRequestId()
    return requestId ? { requestId } : {}
  },
})
