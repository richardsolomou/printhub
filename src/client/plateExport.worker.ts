import { expose, transfer } from 'comlink'
import type { PlatePlacement } from '../core/platePlanner'
import { exportPlateModels, type PlateExportModel } from './plateExportCore'

export type { PlateExportModel } from './plateExportCore'

const api = {
  exportPlate(placements: PlatePlacement[], models: PlateExportModel[]) {
    const archive = exportPlateModels(placements, models)
    return transfer(archive, [archive.buffer])
  },
}

export type PlateExportWorker = typeof api
expose(api)
