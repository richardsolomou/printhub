import { createFileRoute } from '@tanstack/react-router'
import { app } from '../../server/app'
import { requireMutationOrigin } from '../../server/mutationOrigin'
import { generateResinSupports } from '../../server/resinSupportWorker'
import { withRequestContext } from '../../server/requestContext'

const MAX_PROJECT_BYTES = 512 * 1024 * 1024

export const Route = createFileRoute('/api/resin-supports')({
  server: {
    handlers: {
      POST: ({ request }) =>
        withRequestContext(request, async () => {
          requireMutationOrigin(request)
          const instance = await app()
          const identity = await instance.requireIdentity(request.headers)
          if (identity.role !== 'admin') return new Response('forbidden', { status: 403 })
          if (request.headers.get('content-type') !== 'model/3mf') return new Response('expected a 3MF project', { status: 415 })
          const declaredSize = Number(request.headers.get('content-length') ?? 0)
          if (declaredSize > MAX_PROJECT_BYTES) return new Response('project is too large', { status: 413 })
          const project = new Uint8Array(await request.arrayBuffer())
          if (!project.byteLength || project.byteLength > MAX_PROJECT_BYTES) return new Response('project is too large', { status: 413 })

          const generated = await generateResinSupports(project)
          const body = new Uint8Array(generated.supports.byteLength)
          body.set(generated.supports)
          return new Response(body.buffer, {
            headers: {
              'Cache-Control': 'private, no-store',
              'Content-Type': 'model/stl',
              'X-Model-Elevation': String(generated.elevationMm),
            },
          })
        }),
    },
  },
})
