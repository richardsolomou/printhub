import type { ModelFormat } from '../core/modelFormat'

export function platePreviewRevision(
  requestIds: readonly string[],
  requests: readonly { id: string; hasPreview: boolean; previewStatus?: string }[],
) {
  return requestIds
    .map((requestId) => {
      const request = requests.find((candidate) => candidate.id === requestId)
      return `${requestId}:${request?.hasPreview ? 'ready' : (request?.previewStatus ?? 'missing')}`
    })
    .join('|')
}

export function requestPreviewRevision(request: { hasPreview: boolean; previewStatus?: string }) {
  return request.hasPreview ? 'ready' : (request.previewStatus ?? 'missing')
}

export function shouldLoadPlatePreview(hasGeometry: boolean, failedRevision: string | undefined, revision: string) {
  return !hasGeometry && failedRevision !== revision
}

export function threeMfPreviewFailure(request: {
  modelFormat: ModelFormat
  hasPreview: boolean
  previewStatus?: string
  previewError?: string
}) {
  if (request.modelFormat !== '3mf' || request.hasPreview || request.previewStatus !== 'failed') return undefined
  return `Preview failed${request.previewError ? `: ${request.previewError}` : ''}`
}

export function responseModelFormat(response: Pick<Response, 'headers'>): ModelFormat {
  return response.headers.get('Content-Type') === 'model/3mf' ? '3mf' : 'stl'
}

export function isOriginalPreviewFallback(response: Pick<Response, 'headers'>) {
  return response.headers.get('X-Preview-Fallback')?.toLowerCase() === 'original'
}
