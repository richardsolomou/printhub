import type { PrintTechnology } from './types'

const RESIN_ASSUMPTION = 'Solid model volume only; supports, hollowing, drainage, and printing waste are excluded.'
const FDM_ASSUMPTION = '100%-solid equivalent only; walls, infill, supports, brims, rafts, purge, and slicer settings are excluded.'

export type ResinMaterialEstimate = {
  technology: 'resin'
  unit: 'ml'
  perCopy: number
  total: number
  assumption: string
}

export type FdmMaterialEstimate = {
  technology: 'fdm'
  unit: 'g'
  perCopy: number
  total: number
  filamentMetersPerCopy: number
  filamentMetersTotal: number
  densityGPerCm3: number
  filamentDiameterMm: number
  assumption: string
}

export type MaterialEstimate = ResinMaterialEstimate | FdmMaterialEstimate

export function estimateMaterialUsage(input: {
  technology: PrintTechnology
  estimatedVolumeMm3?: number
  quantity?: number
  printer?: {
    technology: PrintTechnology
    filamentDiameterMm?: number
    materialDensityGPerCm3?: number
  }
}): MaterialEstimate | undefined {
  const { technology, estimatedVolumeMm3, printer } = input
  if (estimatedVolumeMm3 === undefined || !Number.isFinite(estimatedVolumeMm3) || estimatedVolumeMm3 < 0) return undefined
  const quantity = input.quantity ?? 1
  if (!Number.isInteger(quantity) || quantity < 1) return undefined

  const volumeMl = estimatedVolumeMm3 / 1_000
  if (technology === 'resin') {
    return { technology, unit: 'ml', perCopy: volumeMl, total: volumeMl * quantity, assumption: RESIN_ASSUMPTION }
  }

  if (!printer || printer.technology !== 'fdm') return undefined
  const { materialDensityGPerCm3, filamentDiameterMm } = printer
  if (materialDensityGPerCm3 === undefined || filamentDiameterMm === undefined) return undefined
  if (!Number.isFinite(materialDensityGPerCm3) || materialDensityGPerCm3 <= 0) return undefined
  if (!Number.isFinite(filamentDiameterMm) || filamentDiameterMm <= 0) return undefined

  const perCopy = volumeMl * materialDensityGPerCm3
  const filamentMetersPerCopy = estimatedVolumeMm3 / (Math.PI * Math.pow(filamentDiameterMm / 2, 2)) / 1_000
  return {
    technology,
    unit: 'g',
    perCopy,
    total: perCopy * quantity,
    filamentMetersPerCopy,
    filamentMetersTotal: filamentMetersPerCopy * quantity,
    densityGPerCm3: materialDensityGPerCm3,
    filamentDiameterMm,
    assumption: FDM_ASSUMPTION,
  }
}
