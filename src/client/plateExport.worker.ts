import { expose, transfer } from 'comlink'
import { parseStl } from '../core/mesh/stl'
import { exportPlate3mf, type Plate3mfOptions } from '../core/mesh/threeMf'
import type { PlatePlacement } from '../core/platePlanner'

export type PlateExportModel = {
  requestId: string
  name: string
  buffer: ArrayBuffer
}

const api = {
  exportPlate(placements: PlatePlacement[], models: PlateExportModel[], options?: Plate3mfOptions, generatedSupports?: ArrayBuffer) {
    const meshes = new Map(
      models.map((model) => [model.requestId, { name: model.name, positions: parseStl(new Uint8Array(model.buffer)) }]),
    )
    const archive = exportPlate3mf(placements, meshes, {
      ...options,
      generatedSupports: generatedSupports
        ? { name: 'PrintHub generated supports', positions: parseStl(new Uint8Array(generatedSupports), { center: false }) }
        : undefined,
    })
    return transfer(archive, [archive.buffer])
  },
}

export type PlateExportWorker = typeof api
expose(api)
