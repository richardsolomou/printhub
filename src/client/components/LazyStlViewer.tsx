import { Suspense, lazy } from 'react'
import { Skeleton } from '@/components/ui/skeleton'

const StlViewer = lazy(() => import('./StlViewer'))

type Props = { requestId?: string; file?: File; hasPreview?: boolean }

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
