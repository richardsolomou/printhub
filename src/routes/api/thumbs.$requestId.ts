import { createFileRoute } from '@tanstack/react-router'
import { app } from '../../server/app'

export const Route = createFileRoute('/api/thumbs/$requestId')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const instance = await app()
        instance.auth.require()
        const printRequest = instance.service.getRequest(params.requestId)
        const match = printRequest?.thumbnail?.match(/^data:(image\/\w+);base64,(.+)$/)
        if (!match) return new Response('not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
        return new Response(Buffer.from(match[2], 'base64'), {
          headers: {
            'Content-Type': match[1],
            'Cache-Control': 'private, max-age=31536000, immutable',
          },
        })
      },
    },
  },
})
