import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import type { PlatePlacement } from '../platePlanner'
import { exportPlate3mf, parseThreeMf } from './threeMf'

const positions = new Float32Array([
  -1, -2, -3, 1, -2, -3, 1, 2, -3, -1, -2, -3, 1, 2, -3, -1, 2, -3, -1, -2, 3, 1, 2, 3, 1, -2, 3, -1, -2, 3, -1, 2, 3, 1, 2, 3, -1, -2, -3,
  -1, -2, 3, 1, -2, 3, -1, -2, -3, 1, -2, 3, 1, -2, -3, 1, -2, -3, 1, -2, 3, 1, 2, 3, 1, -2, -3, 1, 2, 3, 1, 2, -3, 1, 2, -3, 1, 2, 3, -1,
  2, 3, 1, 2, -3, -1, 2, 3, -1, 2, -3, -1, 2, -3, -1, 2, 3, -1, -2, 3, -1, 2, -3, -1, -2, 3, -1, -2, -3,
])

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

  it('replaces characters that XML 1.0 cannot represent in exported names', () => {
    const archive = unzipSync(exportPlate3mf([placement('copy-1')], new Map([['request-1', { name: 'Bad\u0001name\ud800', positions }]])))
    const model = strFromU8(archive['3D/3dmodel.model'])

    expect(model).toContain('name="Bad�name�"')
    expect(parseThreeMf(zipSync(archive))).toHaveLength(positions.length)
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

  it('rejects plates without every original mesh', () => {
    expect(() => exportPlate3mf([placement('copy-1')], new Map())).toThrow('Missing original mesh for Model copy-1')
  })
})

function modelArchive(model: string, extra: Record<string, Uint8Array> = {}, relationships?: string) {
  return zipSync({
    '_rels/.rels': strToU8(
      relationships ??
        '<Relationships><Relationship Target="/3D/model.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
    ),
    '3D/model.model': strToU8(model),
    ...extra,
  })
}

function meshModel(attributes = '', triangleAttributes = '') {
  return `<model ${attributes}><resources><object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2" ${triangleAttributes}/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>`
}

describe('3MF import', () => {
  it('applies units and nested component transforms', () => {
    const archive = modelArchive(`<model unit="inch"><resources>
      <object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>
      <object id="2"><components><component objectid="1" transform="1 0 0 0 1 0 0 0 1 1 0 0"/></components></object>
    </resources><build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 2 0 0"/></build></model>`)

    expect([...parseThreeMf(archive)]).toEqual([76.19999694824219, 0, 0, 101.5999984741211, 0, 0, 76.19999694824219, 25.399999618530273, 0])
  })

  it('rejects malformed archives and XML declarations', () => {
    expect(() => parseThreeMf(strToU8('not a zip'))).toThrow('invalid 3MF archive')
    expect(() => parseThreeMf(modelArchive('<model>'))).toThrow('invalid 3MF model XML')
    expect(() => parseThreeMf(modelArchive('<!DOCTYPE model><model/>'))).toThrow('unsupported declarations')
  })

  it('rejects unsafe archive paths', () => {
    expect(() => parseThreeMf(modelArchive(meshModel(), { '../escape': strToU8('x') }))).toThrow('unsafe archive path')
  })

  it('requires one package relationship and an existing model part', () => {
    const noStartPart = '<Relationships><Relationship Target="/3D/model.model" Type="other"/></Relationships>'
    const missingModel =
      '<Relationships><Relationship Target="/3D/missing.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'

    expect(() => parseThreeMf(modelArchive(meshModel(), {}, noStartPart))).toThrow('must define one StartPart relationship')
    expect(() => parseThreeMf(modelArchive(meshModel(), {}, missingModel))).toThrow('model part is missing')
  })

  it('rejects invalid triangle indices and component cycles', () => {
    const invalidIndex = meshModel().replace('v3="2"', 'v3="3"')
    const cycle =
      '<model><resources><object id="1"><components><component objectid="2"/></components></object><object id="2"><components><component objectid="1"/></components></object></resources><build><item objectid="1"/></build></model>'

    expect(() => parseThreeMf(modelArchive(invalidIndex))).toThrow('missing vertex 3')
    expect(() => parseThreeMf(modelArchive(cycle))).toThrow('cyclic 3MF component reference')
  })

  it('rejects required extensions, materials, and non-model meshes', () => {
    expect(() => parseThreeMf(modelArchive(meshModel('requiredextensions="vendor"')))).toThrow('requires unsupported extensions')
    expect(() => parseThreeMf(modelArchive(meshModel('', 'pid="2"')))).toThrow('material assignments are not supported')
    expect(() => parseThreeMf(modelArchive(meshModel().replace('<object id="1">', '<object id="1" type="support">')))).toThrow(
      'object type support is not supported',
    )
  })

  it('corrects triangle winding for reflected transforms', () => {
    const reflected = meshModel().replace('<item objectid="1"/>', '<item objectid="1" transform="-1 0 0 0 1 0 0 0 1 0 0 0"/>')

    expect([...parseThreeMf(modelArchive(reflected))]).toEqual([0, 0, 0, 0, 1, 0, -1, 0, 0])
  })

  it('round-trips exported plates', () => {
    const archive = exportPlate3mf([placement('copy-1')], new Map([['request-1', { name: 'Model', positions }]]))

    expect(parseThreeMf(archive)).toHaveLength(positions.length)
  })
})
