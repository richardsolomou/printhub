import { createFileRoute } from '@tanstack/react-router'
import { app } from '../../server/app'

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: async () => {
        try {
          const instance = await app()
          instance.repository.countUsers()
          await instance.assets.writable()
          return Response.json({ ok: true })
        } catch {
          return Response.json({ ok: false }, { status: 503 })
        }
      },
    },
  },
})
