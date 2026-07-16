import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { parseThreeMf } from '../core/mesh/threeMf'
import type { PlatePlacement } from '../core/platePlanner'
import { exportPlateModels } from './plateExportCore'

describe('exportPlateModels', () => {
  function archive(model: string) {
    return zipSync({
      '[Content_Types].xml': strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
      ),
      '_rels/.rels': strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rel0" Target="3D/model.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
      ),
      '3D/model.model': strToU8(model),
    })
  }

  const placement: PlatePlacement = {
    copyId: 'copy-1',
    requestId: 'request-1',
    name: 'Model',
    footprint: { widthMm: 1, depthMm: 1, known: true },
    estimatedSupportedHeightMm: 1,
    orientationQuaternion: [0, 0, 0, 1],
    xMm: 10,
    yMm: 10,
    rotationZDegrees: 0,
  }

  it('exports the complete original 3MF geometry', () => {
    const model = `<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1"><mesh><vertices>
      <vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/><vertex x="0" y="0" z="1"/>
      </vertices><triangles><triangle v1="0" v2="1" v3="2"/><triangle v1="0" v2="3" v3="1"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>`
    const original = archive(model)

    const exported = exportPlateModels([placement], [{ requestId: 'request-1', name: 'Model', format: '3mf', buffer: original.buffer }])

    expect(parseThreeMf(exported)).toHaveLength(18)
  })

  it('exports supported mesh leaves through typed component containers', () => {
    const original = archive(
      `<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>
        <object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>
        <object id="2" type="surface"><components><component objectid="1"/></components></object>
      </resources><build><item objectid="2"/></build></model>`,
    )

    const exported = exportPlateModels([placement], [{ requestId: 'request-1', name: 'Model', format: '3mf', buffer: original.buffer }])

    expect(parseThreeMf(exported)).toHaveLength(9)
  })

  it.each(['solidsupport', 'support', 'surface'] as const)('rejects %s geometry that cannot be represented faithfully', (type) => {
    const original = archive(
      `<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="${type}"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>`,
    )

    expect(() =>
      exportPlateModels([placement], [{ requestId: 'request-1', name: 'Model', format: '3mf', buffer: original.buffer }]),
    ).toThrow(`${type} is not supported for this operation`)
  })

  it.each([
    '<basematerials id="2"><base name="Blue" displaycolor="#0000FFFF"/></basematerials><object id="1" pid="2" pindex="0"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>',
    '<object id="1" pid="2" pindex="0"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>',
    '<object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2" pid="2" p1="0"/></triangles></mesh></object>',
  ])('rejects core material semantics that plate export cannot preserve', (resources) => {
    const original = archive(
      `<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>${resources}</resources><build><item objectid="1"/></build></model>`,
    )

    expect(() =>
      exportPlateModels([placement], [{ requestId: 'request-1', name: 'Model', format: '3mf', buffer: original.buffer }]),
    ).toThrow('core material assignments are not supported for plate export')
  })

  it('ignores material resources and assignments outside the build graph', () => {
    const original = archive(
      `<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>
        <basematerials id="3"><base name="Blue" displaycolor="#0000FFFF"/></basematerials>
        <object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>
        <object id="2" pid="2" pindex="0"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2" pid="2" p1="0"/></triangles></mesh></object>
      </resources><build><item objectid="1"/></build></model>`,
    )

    const exported = exportPlateModels([placement], [{ requestId: 'request-1', name: 'Model', format: '3mf', buffer: original.buffer }])

    expect(parseThreeMf(exported)).toHaveLength(9)
  })

  it('rejects reachable material assignments through component objects', () => {
    const original = archive(
      `<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>
        <object id="1" pid="2" pindex="0"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>
        <object id="2"><components><component objectid="1"/></components></object>
      </resources><build><item objectid="2"/></build></model>`,
    )

    expect(() =>
      exportPlateModels([placement], [{ requestId: 'request-1', name: 'Model', format: '3mf', buffer: original.buffer }]),
    ).toThrow('core material assignments are not supported for plate export')
  })
})
