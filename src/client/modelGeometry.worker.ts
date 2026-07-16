import { expose, transfer } from 'comlink'
import { prepareThreeMfGeometry } from './modelGeometry'

const api = {
  prepareThreeMf(buffer: ArrayBuffer) {
    const prepared = prepareThreeMfGeometry(buffer)
    return transfer(prepared, [prepared.positions.buffer, prepared.normals.buffer])
  },
}

export type ModelGeometryWorker = typeof api
expose(api)
