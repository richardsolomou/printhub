import { parseStl } from '../core/mesh/stl'
import { exportPlate3mf, parseThreeMf, SUPPORTED_THREE_MF_PARSE_OPTIONS } from '../core/mesh/threeMf'
import type { ModelFormat } from '../core/modelFormat'
import type { PlatePlacement } from '../core/platePlanner'

export type PlateExportModel = {
  requestId: string
  name: string
  format: ModelFormat
  buffer: ArrayBuffer
}

export function exportPlateModels(placements: PlatePlacement[], models: PlateExportModel[]) {
  const meshes = new Map(
    models.map((model) => [
      model.requestId,
      {
        name: model.name,
        positions:
          model.format === '3mf'
            ? parseThreeMf(new Uint8Array(model.buffer), SUPPORTED_THREE_MF_PARSE_OPTIONS)
            : parseStl(new Uint8Array(model.buffer)),
      },
    ]),
  )
  return exportPlate3mf(placements, meshes)
}
