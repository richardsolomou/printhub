import { useEffect, useRef, useState } from 'react'

// Fetch-based lazy image: <img> requests carry Sec-Fetch-Dest: image, which
// nitro's dev middleware misroutes to static assets; fetch() passes everywhere
// and the immutable cache header still applies.
export function LazyThumb({ jobId }: { jobId: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    let objectUrl: string | null = null
    let cancelled = false

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      fetch(`/api/thumbs/${jobId}`)
        .then(async (res) => {
          if (!res.ok) throw new Error(String(res.status))
          objectUrl = URL.createObjectURL(await res.blob())
          if (!cancelled) setSrc(objectUrl)
        })
        .catch(() => !cancelled && setFailed(true))
    })
    observer.observe(element)

    return () => {
      cancelled = true
      observer.disconnect()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [jobId])

  return (
    <div className="thumb" ref={ref}>
      {src && !failed ? <img src={src} alt="" /> : <span className="placeholder">stl</span>}
    </div>
  )
}
