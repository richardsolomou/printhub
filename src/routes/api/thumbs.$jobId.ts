import { createFileRoute } from '@tanstack/react-router'
import { app } from '../../server/app'

export const Route = createFileRoute('/api/thumbs/$jobId')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const instance = await app()
        instance.auth.require()
        const job = instance.service.getJob(params.jobId)
        const match = job?.thumbnail?.match(/^data:(image\/\w+);base64,(.+)$/)
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
