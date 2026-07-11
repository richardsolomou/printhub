import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three-stdlib'
import { buildScene, frameCamera, parseStl } from '../lib/stl'

export default function StlViewer({ jobId, file }: { jobId?: string; file?: File }) {
  const mountRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [statusText, setStatusText] = useState('loading model…')

  useEffect(() => {
    const mount = mountRef.current
    if (!mount || (!jobId && !file)) return

    let disposed = false
    let renderer: THREE.WebGLRenderer | undefined
    let controls: OrbitControls | undefined
    let frame = 0
    let observer: ResizeObserver | undefined

    setStatus('loading')
    setStatusText('loading model…')
    ;(async () => {
      try {
        let buffer: ArrayBuffer
        if (file) {
          buffer = await file.arrayBuffer()
        } else {
          const res = await fetch(`/api/files/${jobId}?inline=1`)
          if (!res.ok) throw new Error(`fetch failed: ${res.status}`)
          const total = Number(res.headers.get('Content-Length')) || 0
          if (res.body && total) {
            const reader = res.body.getReader()
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
            buffer = await res.arrayBuffer()
          }
        }
        setStatusText('preparing model…')
        await new Promise((r) => setTimeout(r)) // let the status paint before the parse blocks
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
        const sphere = new THREE.Box3().setFromObject(mesh).getBoundingSphere(new THREE.Sphere())
        controls.target.copy(sphere.center)

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
      } catch {
        if (!disposed) setStatus('error')
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
  }, [jobId, file])

  return (
    <div className="viewer" ref={mountRef}>
      {status === 'loading' && <div className="viewer-status">{statusText}</div>}
      {status === 'error' && <div className="viewer-status">couldn't load this model</div>}
    </div>
  )
}
