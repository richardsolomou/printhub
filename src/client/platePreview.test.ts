import { describe, expect, it } from 'vitest'
import {
  isOriginalPreviewFallback,
  platePreviewRevision,
  requestPreviewRevision,
  responseModelFormat,
  shouldLoadPlatePreview,
  threeMfPreviewFailure,
} from './platePreview'

describe('plate preview loading', () => {
  it('changes revision when preview generation becomes ready after an initial miss', () => {
    const requestIds = ['request-1']
    const missing = platePreviewRevision(requestIds, [{ id: 'request-1', hasPreview: false, previewStatus: 'running' }])
    const ready = platePreviewRevision(requestIds, [{ id: 'request-1', hasPreview: true, previewStatus: 'ready' }])

    expect(ready).not.toBe(missing)
  })

  it('recognizes an original preview fallback before reading its body', () => {
    const response = new Response(null, {
      headers: { 'Content-Type': 'model/3mf', 'X-Preview-Fallback': 'original' },
    })

    expect(isOriginalPreviewFallback(response)).toBe(true)
    expect(responseModelFormat(response)).toBe('3mf')
  })

  it('describes failed 3MF previews and changes revision when they recover', () => {
    const failed = { modelFormat: '3mf' as const, hasPreview: false, previewStatus: 'failed', previewError: 'worker unavailable' }

    expect(threeMfPreviewFailure(failed)).toBe('Preview failed: worker unavailable')
    expect(requestPreviewRevision(failed)).toBe('failed')
    expect(requestPreviewRevision({ ...failed, hasPreview: true, previewStatus: 'ready' })).toBe('ready')
    expect(threeMfPreviewFailure({ ...failed, modelFormat: 'stl' })).toBeUndefined()
  })

  it('retries a ready preview after a transient failure is manually cleared', () => {
    expect(shouldLoadPlatePreview(false, 'ready', 'ready')).toBe(false)
    expect(shouldLoadPlatePreview(false, undefined, 'ready')).toBe(true)
  })
})
