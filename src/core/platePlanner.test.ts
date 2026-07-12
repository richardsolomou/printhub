import { describe, expect, it } from 'vitest'
import { packPlate, placementIssues, type PlateCandidate, type PrinterProfile } from './platePlanner'

const printer: PrinterProfile = {
  id: 'test',
  name: 'Test printer',
  widthMm: 100,
  depthMm: 60,
  heightMm: 150,
  spacingMm: 2,
  supportMarginMm: 0,
  adhesionMarginMm: 0,
  heightAllowanceMm: 0,
  maxHeightDifferenceMm: 20,
}

const candidate = (copyId: string, widthMm: number, depthMm: number, height = 30): PlateCandidate => ({
  copyId,
  requestId: copyId.split(':')[0] ?? copyId,
  name: copyId,
  footprint: { widthMm, depthMm, known: true },
  estimatedSupportedHeightMm: height,
})

describe('plate planner', () => {
  it('packs copy-level quantities and rotates models to fit', () => {
    const result = packPlate([candidate('a:1', 55, 80), candidate('a:2', 20, 20)], printer)
    expect(result.placements.map((placement) => placement.copyId)).toContain('a:1')
    expect(result.placements.some((placement) => placement.rotationZDegrees === 90)).toBe(true)
    expect(new Set(result.placements.map((placement) => placement.copyId)).size).toBe(result.placements.length)
  })

  it('detects overlaps, spacing violations, and plate bounds', () => {
    const base = candidate('a:1', 20, 20)
    const issues = placementIssues(
      [
        { ...base, xMm: 10, yMm: 10, rotationZDegrees: 0 },
        { ...candidate('b:1', 20, 20), xMm: 25, yMm: 10, rotationZDegrees: 0 },
        { ...candidate('c:1', 10, 10), xMm: 98, yMm: 55, rotationZDegrees: 0 },
      ],
      printer,
    )
    expect(issues.get('a:1')).toContain('overlap')
    expect(issues.get('b:1')).toContain('overlap')
    expect(issues.get('c:1')).toContain('out-of-bounds')

    const spacing = placementIssues(
      [
        { ...base, xMm: 10, yMm: 10, rotationZDegrees: 0 },
        { ...candidate('b:1', 20, 20), xMm: 31, yMm: 10, rotationZDegrees: 0 },
      ],
      printer,
    )
    expect(spacing.get('a:1')).toContain('spacing')
  })

  it('adds support and adhesion margins to the packing footprint', () => {
    const expanded = { ...printer, supportMarginMm: 4, adhesionMarginMm: 2 }
    const result = packPlate([candidate('a:1', 40, 40), candidate('b:1', 40, 40)], expanded)
    expect(result.placements).toHaveLength(1)
    expect(result.skipped).toHaveLength(1)
  })

  it('rejects models whose estimated supported height exceeds the build volume', () => {
    const result = packPlate([candidate('a:1', 20, 20, 151)], printer)
    expect(result.placements).toEqual([])
    expect(result.skipped.map((entry) => entry.copyId)).toEqual(['a:1'])
  })

  it('groups models into the most useful compatible height band', () => {
    const result = packPlate([candidate('short:1', 20, 20, 20), candidate('short:2', 20, 20, 25), candidate('tall:1', 20, 20, 80)], printer)
    expect(result.placements.map((placement) => placement.copyId)).toEqual(expect.arrayContaining(['short:1', 'short:2']))
    expect(result.placements.map((placement) => placement.copyId)).not.toContain('tall:1')
    expect(result.skipped.map((entry) => entry.copyId)).toContain('tall:1')
  })
})
