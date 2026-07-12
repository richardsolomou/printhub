import { wrap } from 'comlink'
import * as THREE from 'three'
import type { PlateAnalysisWorker } from './plateAnalysis.worker'

type Analysis = { geometry: THREE.BufferGeometry; size: { x: number; y: number; z: number } }
type WorkerSlot = { worker: Worker; api: ReturnType<typeof wrap<PlateAnalysisWorker>> }

const cache = new Map<string, Promise<Analysis>>()
const slots: WorkerSlot[] = []
let nextSlot = 0

function workerCount() {
  const available = typeof navigator === 'undefined' ? 2 : navigator.hardwareConcurrency || 2
  return Math.max(2, Math.min(4, Math.floor(available / 2)))
}

function slot() {
  while (slots.length < workerCount()) {
    const worker = new Worker(new URL('./plateAnalysis.worker.ts', import.meta.url), { type: 'module' })
    slots.push({ worker, api: wrap<PlateAnalysisWorker>(worker) })
  }
  const selected = slots[nextSlot % slots.length]
  nextSlot++
  return selected
}

export function analyzePlateModel(requestId: string, buffer: ArrayBuffer): Promise<Analysis> {
  const existing = cache.get(requestId)
  if (existing) return existing
  const analysis = slot()
    .api.analyze(buffer)
    .then(({ positions, normals, size }) => {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
      return { geometry, size }
    })
    .catch((error) => {
      cache.delete(requestId)
      throw error
    })
  cache.set(requestId, analysis)
  return analysis
}
