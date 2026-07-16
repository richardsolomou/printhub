export type ViewerLoadState = {
  fullRequested: boolean
  stalePreviewFallback: boolean
  retryAttempt: number
}

export const initialViewerLoadState: ViewerLoadState = {
  fullRequested: false,
  stalePreviewFallback: false,
  retryAttempt: 0,
}

export type ViewerLoadAction = 'request-full' | 'preview-fallback' | 'retry' | 'reset'

export function reduceViewerLoadState(state: ViewerLoadState, action: ViewerLoadAction): ViewerLoadState {
  if (action === 'reset') return initialViewerLoadState
  if (action === 'preview-fallback') return { ...state, stalePreviewFallback: true }
  if (action === 'request-full') return { ...state, fullRequested: true }
  return { ...state, retryAttempt: state.retryAttempt + 1 }
}
