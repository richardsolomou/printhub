import { useState } from 'react'

// Plain URL + native lazy loading; the response is immutable-cached. Only
// mounted once the request has a thumbnail (hasThumbnail gates it).
export function LazyThumb({ requestId }: { requestId: string }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className="thumb grid size-16 shrink-0 place-items-center overflow-hidden rounded-md border bg-background [background-image:var(--grid)] [background-size:12px_12px]">
      {failed ? (
        <span className="font-mono text-[10px] text-muted-foreground">stl</span>
      ) : (
        <img
          className="size-full object-contain select-none"
          loading="lazy"
          decoding="async"
          src={`/api/thumbs/${requestId}`}
          alt=""
          draggable={false}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  )
}
