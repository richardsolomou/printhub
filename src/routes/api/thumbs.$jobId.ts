import { createFileRoute } from '@tanstack/react-router'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { convex } from '../../server/convexServer'
import { readUserEmail } from '../../server/identity'

export const Route = createFileRoute('/api/thumbs/$jobId')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        readUserEmail()
        const job = await convex().query(api.jobs.get, { id: params.jobId as Id<'jobs'> })
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
