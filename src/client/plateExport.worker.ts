import { expose, transfer } from 'comlink'
import { parseStl } from '../core/mesh/stl'
import { exportPlateVoxl, type DragonFruitPlate } from '../core/mesh/voxl'
import type { PlatePlacement } from '../core/platePlanner'

export type PlateExportModel = {
  requestId: string
  name: string
  buffer: ArrayBuffer
}

const api = {
  exportPlateVoxl(placements: PlatePlacement[], models: PlateExportModel[], plate: DragonFruitPlate) {
    const meshes = new Map(
      models.map((model) => [model.requestId, { name: model.name, positions: parseStl(new Uint8Array(model.buffer)) }]),
    )
    const archive = exportPlateVoxl(placements, meshes, plate)
    return transfer(archive, [archive.buffer])
  },
}

export type PlateExportWorker = typeof api
expose(api)
