import { describe, expect, it } from 'vitest'
import { analyzePositions } from './meshAnalysis'

const tetrahedron = new Float32Array([
  0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1,
])

describe('mesh analysis', () => {
  it('measures original bounds and enclosed volume', () => {
    expect(analyzePositions(tetrahedron)).toEqual({
      widthMm: 1,
      depthMm: 1,
      heightMm: 1,
      estimatedVolumeMm3: 1 / 6,
      volumeReliable: true,
    })
  })

  it('does not claim material volume for an open mesh', () => {
    expect(analyzePositions(tetrahedron.slice(0, -9))).toMatchObject({ estimatedVolumeMm3: undefined, volumeReliable: false })
  })

  it('is independent of translation', () => {
    const translated = tetrahedron.map((value, index) => value + (index % 3 === 0 ? 10 : index % 3 === 1 ? -4 : 7))
    expect(analyzePositions(translated).estimatedVolumeMm3).toBeCloseTo(1 / 6)
  })
})
