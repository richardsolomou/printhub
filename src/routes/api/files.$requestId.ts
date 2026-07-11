import fs from 'node:fs'
import zlib from 'node:zlib'
import { Readable } from 'node:stream'
import { createFileRoute } from '@tanstack/react-router'
import { app } from '../../server/app'

export const Route = createFileRoute('/api/files/$requestId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const instance = await app()
        instance.auth.require()
        const printRequest = instance.service.getRequest(params.requestId)
        if (!printRequest) return new Response('not found', { status: 404 })

        const url = new URL(request.url)
        const wantPreview = url.searchParams.get('preview') === '1'
        const relativePath = wantPreview && printRequest.previewPath ? printRequest.previewPath : printRequest.filePath
        const filePath = instance.assets.absolute(relativePath)
        let size: number
        try {
          size = (await fs.promises.stat(filePath)).size
        } catch {
          return new Response('file missing on disk', { status: 404 })
        }

        const headers = new Headers({
          'Content-Type': 'model/stl',
          // A request's file never changes, so let the browser keep it.
          'Cache-Control': 'private, max-age=31536000, immutable',
          // Uncompressed size, so the client can show progress across gzip.
          'X-File-Size': String(size),
        })
        if (url.searchParams.get('inline') !== '1') {
          const safeName = printRequest.fileName.replace(/["\r\n]/g, '')
          headers.set('Content-Disposition', `attachment; filename="${safeName}"`)
        }

        // STL binary gzips ~2-3x; fastest level keeps NAS CPU cheap.
        const stream = fs.createReadStream(filePath)
        if ((request.headers.get('accept-encoding') ?? '').includes('gzip')) {
          headers.set('Content-Encoding', 'gzip')
          const gzip = zlib.createGzip({ level: zlib.constants.Z_BEST_SPEED })
          return new Response(Readable.toWeb(stream.pipe(gzip)) as ReadableStream, { headers })
        }
        headers.set('Content-Length', String(size))
        return new Response(Readable.toWeb(stream) as ReadableStream, { headers })
      },
    },
  },
})
