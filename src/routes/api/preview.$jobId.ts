import fs from 'node:fs'
import path from 'node:path'
import { createFileRoute } from '@tanstack/react-router'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { convex, writeSecret } from '../../server/convexServer'
import { readUserEmail } from '../../server/identity'
import { absolutePath } from '../../server/files'

// Self-healing previews: a browser that just downloaded a legacy full model
// posts back the decimated version so the next viewer gets the fast path.
export const Route = createFileRoute('/api/preview/$jobId')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        readUserEmail()
        const id = params.jobId as Id<'jobs'>
        const job = await convex().query(api.jobs.get, { id })
        if (!job) return new Response('not found', { status: 404 })
        if (job.previewPath) return Response.json({ ok: true }) // someone beat us to it

        const bytes = Buffer.from(await request.arrayBuffer())
        const fullSize = (await fs.promises.stat(absolutePath(job.filePath)).catch(() => null))?.size ?? 0
        // Must actually be a decimation of this model, not arbitrary junk.
        if (bytes.length < 84 || bytes.length > 50 * 1024 * 1024 || bytes.length >= fullSize) {
          return Response.json({ error: 'invalid preview' }, { status: 400 })
        }

        const previewPath = path.join('.previews', path.basename(job.filePath))
        await fs.promises.mkdir(path.dirname(absolutePath(previewPath)), { recursive: true })
        await fs.promises.writeFile(absolutePath(previewPath), bytes)
        try {
          await convex().mutation(api.jobs.setPreview, { secret: writeSecret(), id, previewPath })
        } catch {
          await fs.promises.rm(absolutePath(previewPath), { force: true })
        }
        return Response.json({ ok: true })
      },
    },
  },
})
