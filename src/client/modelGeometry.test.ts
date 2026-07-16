import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { persistedModelGeometryState, prepareThreeMfGeometry } from './modelGeometry'

describe('prepareThreeMfGeometry', () => {
  it('switches persisted 3MF models from preview STL to the original archive', () => {
    expect(persistedModelGeometryState('3mf', true, false)).toEqual({
      source: { preview: true, format: 'stl' },
      waitingForPreview: false,
      requiresFullDetailConfirmation: false,
    })
    expect(persistedModelGeometryState('3mf', true, true)).toEqual({
      source: { preview: false, format: '3mf' },
      waitingForPreview: false,
      requiresFullDetailConfirmation: false,
    })
  })

  it('requires confirmation before loading the original 3MF after preview failure', () => {
    expect(persistedModelGeometryState('3mf', false, false, 'failed')).toEqual({
      source: { preview: false, format: '3mf' },
      waitingForPreview: false,
      requiresFullDetailConfirmation: true,
    })
    expect(persistedModelGeometryState('3mf', false, true, 'failed')).toEqual({
      source: { preview: false, format: '3mf' },
      waitingForPreview: false,
      requiresFullDetailConfirmation: false,
    })
  })

  it('centers geometry and prepares face normals off the viewer path', () => {
    const archive = zipSync({
      '[Content_Types].xml': strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
      ),
      '_rels/.rels': strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rel0" Target="/3D/model.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
      ),
      '3D/model.model': strToU8(
        '<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1"><mesh><vertices><vertex x="2" y="4" z="6"/><vertex x="4" y="4" z="6"/><vertex x="2" y="8" z="6"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>',
      ),
    })

    const prepared = prepareThreeMfGeometry(archive.buffer)

    expect(Array.from(prepared.positions)).toEqual([-1, -2, 0, 1, -2, 0, -1, 2, 0])
    expect(Array.from(prepared.normals)).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1])
  })
})
