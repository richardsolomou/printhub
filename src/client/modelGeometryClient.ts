import { releaseProxy, transfer, wrap } from 'comlink'
import type { ModelGeometryWorker } from './modelGeometry.worker'

export function createModelGeometryWorker(
  createWorker: () => Worker = () => new Worker(new URL('./modelGeometry.worker.ts', import.meta.url), { type: 'module' }),
) {
  const worker = createWorker()
  const api = wrap<ModelGeometryWorker>(worker)
  return {
    prepareThreeMf(buffer: ArrayBuffer) {
      return api.prepareThreeMf(transfer(buffer, [buffer]))
    },
    terminate() {
      api[releaseProxy]()
      worker.terminate()
    },
  }
}
