import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import type { PlatePlacement, ResinPrinterProfile } from '../platePlanner'
import { exportPlate3mf } from './threeMf'

const positions = new Float32Array([
  -1, -2, -3, 1, -2, -3, 1, 2, -3, -1, -2, -3, 1, 2, -3, -1, 2, -3, -1, -2, 3, 1, 2, 3, 1, -2, 3, -1, -2, 3, -1, 2, 3, 1, 2, 3, -1, -2, -3,
  -1, -2, 3, 1, -2, 3, -1, -2, -3, 1, -2, 3, 1, -2, -3, 1, -2, -3, 1, -2, 3, 1, 2, 3, 1, -2, -3, 1, 2, 3, 1, 2, -3, 1, 2, -3, 1, 2, 3, -1,
  2, 3, 1, 2, -3, -1, 2, 3, -1, 2, -3, -1, 2, -3, -1, 2, 3, -1, -2, 3, -1, 2, -3, -1, -2, 3, -1, -2, -3,
])

const printer: ResinPrinterProfile = {
  id: 'resin-printer',
  name: 'Resin; Station\nOne',
  printType: 'resin',
  enabled: true,
  widthMm: 130,
  depthMm: 80,
  heightMm: 160,
  spacingMm: 5,
  supportMarginMm: 4,
  adhesionMarginMm: 2,
  heightAllowanceMm: 5,
  maxHeightDifferenceMm: 20,
}

function placement(copyId: string, rotationZDegrees = 0): PlatePlacement {
  return {
    copyId,
    requestId: 'request-1',
    name: `Model ${copyId}`,
    footprint: { widthMm: 2, depthMm: 4, known: true },
    estimatedSupportedHeightMm: 6,
    orientationQuaternion: [0, 0, 0, 1],
    xMm: 20,
    yMm: 30,
    rotationZDegrees,
  }
}

describe('3MF export', () => {
  it('produces deterministic project bytes for cache keys', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2025-01-01T00:00:00Z'))
      const first = exportPlate3mf([placement('copy-1')], new Map([['request-1', { name: 'Model', positions }]]))
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
      const second = exportPlate3mf([placement('copy-1')], new Map([['request-1', { name: 'Model', positions }]]))

      expect(second).toEqual(first)
    } finally {
      vi.useRealTimers()
    }
  })

  it('packages reusable original geometry and separate build items', () => {
    const archive = unzipSync(
      exportPlate3mf([placement('copy-1'), placement('copy-2')], new Map([['request-1', { name: 'Model & part', positions }]])),
    )
    const model = strFromU8(archive['3D/3dmodel.model'])

    expect(Object.keys(archive).sort()).toEqual(['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels'])
    expect(model.match(/<object /g)).toHaveLength(1)
    expect(model.match(/<item /g)).toHaveLength(2)
    expect(model).toContain('name="Model &amp; part"')
    expect(model).toContain('transform="1 0 0 0 1 0 0 0 1 20 30 3"')
    expect(model.match(/<triangle /g)).toHaveLength(12)
  })

  it('writes plate rotation in the 3MF row-major transform order', () => {
    const archive = unzipSync(exportPlate3mf([placement('copy-1', 90)], new Map([['request-1', { name: 'Model', positions }]])))
    const model = strFromU8(archive['3D/3dmodel.model'])

    expect(model).toContain('transform="0 1 0 -1 0 0 0 0 1 20 30 3"')
  })

  it('preserves the selected model orientation and places it on the build surface', () => {
    const oriented: PlatePlacement = { ...placement('copy-1'), orientationQuaternion: [Math.SQRT1_2, 0, 0, Math.SQRT1_2] }
    const archive = unzipSync(exportPlate3mf([oriented], new Map([['request-1', { name: 'Model', positions }]])))
    const model = strFromU8(archive['3D/3dmodel.model'])

    expect(model).toContain('transform="1 0 0 0 0 1 0 -1 0 20 30 2"')
  })

  it('adds PrusaSlicer SLA preparation settings without changing the model package', () => {
    const archive = unzipSync(
      exportPlate3mf([placement('copy-1')], new Map([['request-1', { name: 'Model', positions }]]), {
        resinPreparation: { printer, supportPreset: 'medium' },
      }),
    )
    const config = strFromU8(archive['Metadata/Slic3r_PE.config'])

    expect(config).toContain('; bed_shape = 0x0,130x0,130x80,0x80\n; display_height = 80\n; display_width = 130\n; layer_height = 0.05')
    expect(config).toContain('; printer_settings_id = PrintHub Resin Station One')
    expect(config).toContain('; printer_technology = SLA')
    expect(config).toContain('; support_head_front_diameter = 0.8')
    expect(config).toContain('; support_object_elevation = 5')
    expect(config).toContain('; support_pillar_diameter = 1.2')
    expect(config).toContain('; supports_enable = 1')
  })

  it('bakes generated support geometry at its world coordinates without requesting duplicate supports', () => {
    const supports = new Float32Array([10, 20, 0, 11, 20, 0, 10, 21, 1])
    const archive = unzipSync(
      exportPlate3mf([placement('copy-1')], new Map([['request-1', { name: 'Model', positions }]]), {
        resinPreparation: { printer, supportPreset: 'medium' },
        generatedSupports: { name: 'Generated supports', positions: supports },
        modelElevationMm: 6.5,
      }),
    )
    const model = strFromU8(archive['3D/3dmodel.model'])
    const config = strFromU8(archive['Metadata/Slic3r_PE.config'])

    expect(model.match(/<object /g)).toHaveLength(2)
    expect(model).toContain('name="Generated supports"')
    expect(model).toContain('<vertex x="10" y="20" z="0" />')
    expect(model).toContain('<item objectid="2" />')
    expect(model).toContain('transform="1 0 0 0 1 0 0 0 1 20 30 9.5"')
    expect(config).toContain('; pad_enable = 0')
    expect(config).toContain('; supports_enable = 0')
  })

  it('rejects plates without every original mesh', () => {
    expect(() => exportPlate3mf([placement('copy-1')], new Map())).toThrow('Missing original mesh for Model copy-1')
  })
})
