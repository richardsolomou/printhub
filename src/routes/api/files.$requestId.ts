import zlib from 'node:zlib'
import { Readable } from 'node:stream'
import { createFileRoute } from '@tanstack/react-router'
import { app } from '../../server/app'
import { attachmentContentDisposition } from '../../server/contentDisposition'
import { readRequestedFileAsset } from '../../server/fileAsset'
import { withRequestContext } from '../../server/requestContext'

export const Route = createFileRoute('/api/files/$requestId')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        withRequestContext(request, async () => {
          const instance = await app()
          await instance.requireIdentity(request.headers)
          const printRequest = instance.service.getRequest(params.requestId)
          if (!printRequest) return new Response('not found', { status: 404 })

          const url = new URL(request.url)
          const wantPreview = url.searchParams.get('preview') === '1'
          let requestedAsset: Awaited<ReturnType<typeof readRequestedFileAsset>>
          try {
            requestedAsset = await readRequestedFileAsset(printRequest, wantPreview, (path) => instance.assets.read(path))
          } catch {
            return new Response('file missing in storage', { status: 404 })
          }
          if (!requestedAsset) return new Response('preview not available', { status: 404 })
          const { path: relativePath, fileName, asset, previewFallback } = requestedAsset

          const headers = new Headers({
            'Content-Type': relativePath.toLowerCase().endsWith('.3mf') ? 'model/3mf' : 'model/stl',
            'Cache-Control': wantPreview ? 'private, no-cache' : 'private, max-age=31536000, immutable',
            // Uncompressed size, so the client can show progress across gzip.
            'X-File-Size': String(asset.size),
          })
          if (previewFallback) headers.set('X-Preview-Fallback', 'original')
          if (url.searchParams.get('inline') !== '1') {
            headers.set('Content-Disposition', attachmentContentDisposition(fileName))
          }

          // Binary STL gzips ~2-3x; 3MF is already a ZIP archive.
          if (!relativePath.toLowerCase().endsWith('.3mf') && (request.headers.get('accept-encoding') ?? '').includes('gzip')) {
            headers.set('Content-Encoding', 'gzip')
            const gzip = zlib.createGzip({ level: zlib.constants.Z_BEST_SPEED })
            return new Response(
              Readable.toWeb(Readable.fromWeb(asset.stream as Parameters<typeof Readable.fromWeb>[0]).pipe(gzip)) as ReadableStream,
              { headers },
            )
          }
          headers.set('Content-Length', String(asset.size))
          return new Response(asset.stream, { headers })
        }),
    },
  },
})
