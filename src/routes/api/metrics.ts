import { createFileRoute } from '@tanstack/react-router'
import crypto from 'node:crypto'
import { metrics } from '../../server/metrics'
import { withRequestContext } from '../../server/requestContext'

export const Route = createFileRoute('/api/metrics')({
  server: {
    handlers: {
      GET: ({ request }) =>
        withRequestContext(request, '/api/metrics', async () => {
          const token = process.env.METRICS_TOKEN
          if (token && !validToken(request.headers.get('authorization'), token)) return new Response('unauthorized', { status: 401 })
          await (
            await import('../../server/app')
          )
            .app()
            .then((instance) => instance.refreshDiagnostics())
            .catch(() => undefined)
          return new Response(await metrics.metrics(), { headers: { 'Content-Type': metrics.contentType } })
        }),
    },
  },
})

export function validToken(authorization: string | null, token: string) {
  const supplied = Buffer.from(authorization?.startsWith('Bearer ') ? authorization.slice(7) : '')
  const expected = Buffer.from(token)
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected)
}
