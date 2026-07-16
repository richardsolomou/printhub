import { describe, expect, it } from 'vitest'
import { initialViewerLoadState, reduceViewerLoadState } from './viewerLoadState'

describe('viewer load state', () => {
  it('increments retries without leaving full-detail mode', () => {
    const requested = reduceViewerLoadState(initialViewerLoadState, 'request-full')

    expect(reduceViewerLoadState(requested, 'retry')).toEqual({
      fullRequested: true,
      stalePreviewFallback: false,
      retryAttempt: 1,
    })
  })

  it('resets full-detail and retry state for a different model', () => {
    const failed = { fullRequested: true, stalePreviewFallback: true, retryAttempt: 2 }

    expect(reduceViewerLoadState(failed, 'reset')).toEqual(initialViewerLoadState)
  })
})
