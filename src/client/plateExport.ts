import { transfer, wrap } from 'comlink'
import type { Plate3mfOptions } from '../core/mesh/threeMf'
import type { PlatePlacement } from '../core/platePlanner'
import type { PlateExportModel, PlateExportWorker } from './plateExport.worker'

let worker: Worker | undefined
let api: ReturnType<typeof wrap<PlateExportWorker>> | undefined

export function exportPlate(
  placements: PlatePlacement[],
  models: PlateExportModel[],
  options?: Plate3mfOptions,
  generatedSupports?: ArrayBuffer,
) {
  worker ??= new Worker(new URL('./plateExport.worker.ts', import.meta.url), { type: 'module' })
  api ??= wrap<PlateExportWorker>(worker)
  return api.exportPlate(
    placements,
    transfer(
      models,
      models.map((model) => model.buffer),
    ),
    options,
    generatedSupports ? transfer(generatedSupports, [generatedSupports]) : undefined,
  )
}
