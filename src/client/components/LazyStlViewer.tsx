import { Suspense, lazy } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import type { ModelFormat } from '../../core/modelFormat'

const loadStlViewer = () => import('./StlViewer')
const StlViewer = lazy(loadStlViewer)

type Props = {
  requestId?: string
  file?: File
  hasPreview?: boolean
  modelFormat?: ModelFormat
  previewStatus?: 'pending' | 'running' | 'ready' | 'skipped' | 'failed'
  previewError?: string
}

export function preloadStlViewer() {
  void loadStlViewer()
}

export function LazyStlViewer(viewerProps: Props) {
  return (
    <Suspense
      fallback={
        <Skeleton className="viewer relative mb-3.5 aspect-4/3 w-full overflow-hidden rounded-lg border [background-image:var(--grid)]">
          <div className="absolute inset-0 grid place-items-center font-mono text-xs text-muted-foreground">loading viewer…</div>
        </Skeleton>
      }
    >
      <StlViewer {...viewerProps} />
    </Suspense>
  )
}
