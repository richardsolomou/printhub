import { describe, expect, it } from 'vitest'
import { estimateMaterialUsage } from './material'
import type { PrinterProfile } from './platePlanner'
const fdmPrinter = {
  id: 'fdm',
  name: 'FDM printer',
  technology: 'fdm',
  widthMm: 220,
  depthMm: 220,
  heightMm: 250,
  spacingMm: 3,
  brimMarginMm: 2,
  filamentDiameterMm: 1.75,
  materialDensityGPerCm3: 1.24,
} satisfies PrinterProfile

describe('estimateMaterialUsage', () => {
  it('reports resin geometry volume in milliliters', () => {
    expect(estimateMaterialUsage({ technology: 'resin', estimatedVolumeMm3: 2_500, quantity: 3 })).toMatchObject({
      technology: 'resin',
      unit: 'ml',
      perCopy: 2.5,
      total: 7.5,
    })
  })

  it('reports FDM 100%-solid equivalent mass and filament length', () => {
    expect(estimateMaterialUsage({ technology: 'fdm', estimatedVolumeMm3: 10_000, quantity: 2, printer: fdmPrinter })).toMatchObject({
      technology: 'fdm',
      unit: 'g',
      perCopy: 12.4,
      total: 24.8,
      filamentMetersPerCopy: 10_000 / (Math.PI * Math.pow(1.75 / 2, 2)) / 1_000,
      filamentMetersTotal: 20_000 / (Math.PI * Math.pow(1.75 / 2, 2)) / 1_000,
    })
  })

  it('does not invent FDM usage without matching material settings', () => {
    expect(estimateMaterialUsage({ technology: 'fdm', estimatedVolumeMm3: 10_000 })).toBeUndefined()
  })

  it('rejects invalid geometry and quantities', () => {
    expect(estimateMaterialUsage({ technology: 'resin', estimatedVolumeMm3: Number.NaN })).toBeUndefined()
    expect(estimateMaterialUsage({ technology: 'resin', estimatedVolumeMm3: 1_000, quantity: 0 })).toBeUndefined()
  })
})
