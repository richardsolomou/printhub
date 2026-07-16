import { useEffect, useRef, useState } from 'react'
import { usePostHog } from '@posthog/react'
import * as THREE from 'three'
import { OrbitControls } from 'three-stdlib'
import { buildScene, frameCamera, parseStl } from '../stl'

type PreviewStatus = 'pending' | 'running' | 'ready' | 'skipped' | 'failed'

export default function StlViewer({
  requestId,
  file,
  hasPreview = false,
  previewStatus,
  previewError,
}: {
  requestId?: string
  file?: File
  hasPreview?: boolean
  previewStatus?: PreviewStatus
  previewError?: string
}) {
  const posthog = usePostHog()
  const mountRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [statusText, setStatusText] = useState('loading model…')

  useEffect(() => {
    const mount = mountRef.current
    if (!mount || (!requestId && !file)) return
    if (requestId && !hasPreview && (previewStatus === 'pending' || previewStatus === 'running')) {
      setStatus('loading')
      setStatusText('generating preview…')
      return
    }
    if (requestId && !hasPreview && previewStatus === 'failed') {
      setStatus('error')
      setStatusText(previewError ? `Preview failed: ${previewError}` : 'Preview generation failed.')
      return
    }

    let disposed = false
    let renderer: THREE.WebGLRenderer | undefined
    let controls: OrbitControls | undefined
    let frame = 0
    let observer: ResizeObserver | undefined

    setStatus('loading')
    setStatusText('loading model…')
    void (async () => {
      try {
        let buffer: ArrayBuffer
        if (file) {
          buffer = await file.arrayBuffer()
        } else {
          const response = await fetch(`/api/files/${requestId}?inline=1${hasPreview ? '&preview=1' : ''}`)
          if (!response.ok) throw new Error(`fetch failed: ${response.status}`)
          const total = Number(response.headers.get('X-File-Size') ?? response.headers.get('Content-Length')) || 0
          if (response.body && total) {
            const reader = response.body.getReader()
            const data = new Uint8Array(total)
            let received = 0
            for (;;) {
              const { done, value } = await reader.read()
              if (done) break
              data.set(value, received)
              received += value.length
              setStatusText(`downloading… ${Math.min(100, Math.round((received / total) * 100))}%`)
            }
            buffer = data.buffer
          } else {
            buffer = await response.arrayBuffer()
          }
        }
        setStatusText('preparing model…')
        await new Promise((resolve) => setTimeout(resolve))

        const geometry = parseStl(buffer)
        if (disposed) {
          geometry.dispose()
          return
        }

        const { scene, mesh } = buildScene(geometry)
        const camera = new THREE.PerspectiveCamera(40, mount.clientWidth / mount.clientHeight)
        frameCamera(camera, mesh)
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        renderer.setSize(mount.clientWidth, mount.clientHeight)
        mount.appendChild(renderer.domElement)

        controls = new OrbitControls(camera, renderer.domElement)
        controls.enableDamping = true
        controls.target.copy(new THREE.Box3().setFromObject(mesh).getBoundingSphere(new THREE.Sphere()).center)
        observer = new ResizeObserver(() => {
          if (!renderer) return
          camera.aspect = mount.clientWidth / mount.clientHeight
          camera.updateProjectionMatrix()
          renderer.setSize(mount.clientWidth, mount.clientHeight)
        })
        observer.observe(mount)

        const tick = () => {
          controls?.update()
          renderer?.render(scene, camera)
          frame = requestAnimationFrame(tick)
        }
        tick()
        setStatus('ready')
      } catch (error) {
        if (!disposed) {
          posthog.captureException(error, { area: 'stl_viewer', showing_preview: hasPreview })
          setStatusText("couldn't load this model")
          setStatus('error')
        }
      }
    })()

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer?.disconnect()
      controls?.dispose()
      if (renderer) {
        renderer.dispose()
        renderer.domElement.remove()
      }
    }
  }, [requestId, file, hasPreview, previewStatus, previewError, posthog])

  return (
    <div
      className="viewer relative mb-3.5 aspect-4/3 w-full overflow-hidden rounded-lg border bg-background [background-image:var(--grid)] [&_canvas]:block [&_canvas]:size-full max-sm:[&_canvas]:pointer-events-none"
      ref={mountRef}
    >
      {status !== 'ready' && (
        <div className="absolute inset-0 grid place-items-center px-4 text-center font-mono text-xs text-muted-foreground">
          {statusText}
        </div>
      )}
    </div>
  )
}
