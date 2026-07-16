import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import type { PlatePlacement } from '../platePlanner'
import { exportPlate3mf, parseThreeMf, SUPPORTED_THREE_MF_PARSE_OPTIONS } from './threeMf'

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
  const namespacedModel = /<model\b[^>]*\bxmlns=/.test(model)
    ? model
    : model.replace('<model', '<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"')
  const relationshipXml =
    relationships ??
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rel-auto" Target="/3D/model.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'
  const namespacedRelationships = /<Relationships\b[^>]*\bxmlns=/.test(relationshipXml)
    ? relationshipXml
    : relationshipXml.replace('<Relationships', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"')
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
    ),
    '_rels/.rels': strToU8(namespacedRelationships),
    '3D/model.model': strToU8(namespacedModel),
    ...extra,
  })
}

const reservedAttributeFixtures = [
  {
    name: 'xml:lang outside model',
    model:
      '<model><resources><object id="1" xml:lang="en"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>',
    error: 'unsupported XML attribute: xml:lang',
  },
  {
    name: 'xml:space',
    model:
      '<model xml:space="preserve"><resources><object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>',
    error: 'unsupported XML attribute: xml:space',
  },
  {
    name: 'xsi:nil',
    model:
      '<model xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:nil="false"><resources><object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>',
    error: 'unsupported XML Schema instance attribute: xsi:nil',
  },
  {
    name: 'aliased XML Schema instance attribute',
    model:
      '<model xmlns:schema="http://www.w3.org/2001/XMLSchema-instance" schema:nil="false"><resources><object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>',
    error: 'unsupported XML Schema instance attribute: schema:nil',
  },
] as const

function encodeXml(xml: string, encoding: 'utf-8' | 'utf-16le' | 'utf-16be', bom = true) {
  if (encoding === 'utf-8') {
    const body = strToU8(xml)
    return bom ? new Uint8Array([0xef, 0xbb, 0xbf, ...body]) : body
  }
  const body = new Uint8Array(xml.length * 2)
  for (let index = 0; index < xml.length; index++) {
    const code = xml.charCodeAt(index)
    const offset = index * 2
    body[offset + (encoding === 'utf-16le' ? 0 : 1)] = code & 0xff
    body[offset + (encoding === 'utf-16le' ? 1 : 0)] = code >> 8
  }
  if (!bom) return body
  return new Uint8Array([...(encoding === 'utf-16le' ? [0xff, 0xfe] : [0xfe, 0xff]), ...body])
}

function encodedOpcArchive(encoding: 'utf-8' | 'utf-16le' | 'utf-16be') {
  const declaration = encoding === 'utf-8' ? 'UTF-8' : 'UTF-16'
  const prefix = `<?xml version="1.0" encoding="${declaration}"?>`
  return zipSync({
    '[Content_Types].xml': encodeXml(
      `${prefix}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`,
      encoding,
    ),
    '_rels/.rels': encodeXml(
      `${prefix}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rel-auto" Target="/3D/model.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`,
      encoding,
    ),
    '3D/model.model': encodeXml(
      '<?xml version="1.0" encoding="UTF-8"?><model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>',
      'utf-8',
    ),
  })
}

const vendorDefaultNamespaceModel = `<core:model xmlns:core="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns="https://vendor.example/3mf">
  <resources><object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources>
  <core:build><core:item objectid="1"/></core:build>
</core:model>`

describe('3MF import', () => {
  it.each(['utf-8', 'utf-16le', 'utf-16be'] as const)('decodes OPC XML declared as %s', (encoding) => {
    expect(parseThreeMf(encodedOpcArchive(encoding))).toHaveLength(9)
  })

  it.each(['utf-16le', 'utf-16be'] as const)('detects BOM-less %s OPC XML from its declaration bytes', (encoding) => {
    const archive = unzipSync(encodedOpcArchive(encoding))
    archive['[Content_Types].xml'] = archive['[Content_Types].xml'].subarray(2)
    archive['_rels/.rels'] = archive['_rels/.rels'].subarray(2)

    expect(parseThreeMf(zipSync(archive))).toHaveLength(9)
  })

  it('rejects malformed UTF-8 model XML and malformed UTF-16 OPC XML', () => {
    const utf8 = unzipSync(encodedOpcArchive('utf-8'))
    utf8['3D/model.model'] = new Uint8Array([...utf8['3D/model.model'], 0xc3])
    expect(() => parseThreeMf(zipSync(utf8))).toThrow('invalid 3MF model UTF-8 encoding')

    const utf16 = unzipSync(encodedOpcArchive('utf-16le'))
    utf16['_rels/.rels'] = new Uint8Array([...utf16['_rels/.rels'], 0x00])
    expect(() => parseThreeMf(zipSync(utf16))).toThrow('invalid 3MF package relationships UTF-16LE encoding')
  })

  it.each(['utf-16le', 'utf-16be'] as const)('rejects %s 3MF model XML', (encoding) => {
    const archive = unzipSync(modelArchive('<model><resources/><build/></model>'))
    archive['3D/model.model'] = encodeXml(
      '<?xml version="1.0" encoding="UTF-16"?><model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources/><build/></model>',
      encoding,
    )

    expect(() => parseThreeMf(zipSync(archive))).toThrow('3MF model XML must be encoded as UTF-8')
  })

  it('rejects non-UTF-8 model declarations and declarations that contradict OPC bytes', () => {
    const archive = unzipSync(encodedOpcArchive('utf-8'))
    archive['3D/model.model'] = strToU8(
      '<?xml version="1.0" encoding="UTF-16"?><model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources/><build/></model>',
    )
    expect(() => parseThreeMf(zipSync(archive))).toThrow('3MF model XML declaration must name UTF-8')

    const opcArchive = unzipSync(encodedOpcArchive('utf-8'))
    opcArchive['_rels/.rels'] = strToU8(
      '<?xml version="1.0" encoding="UTF-16"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rel-auto" Target="/3D/model.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
    )

    expect(() => parseThreeMf(zipSync(opcArchive))).toThrow('does not match UTF-8 bytes')
  })

  it('applies model units and nested component transforms', () => {
    const archive = modelArchive(`<?xml version="1.0"?>
<model unit="inch" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1"><mesh><vertices>
      <vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/>
    </vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>
    <object id="2"><components><component objectid="1" transform="1 0 0 0 1 0 0 0 1 1 0 0"/></components></object>
  </resources>
  <build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 2 0 0"/></build>
</model>`)

    const parsed = parseThreeMf(archive)
    expect(parsed[0]).toBeCloseTo(76.2)
    expect(parsed[3]).toBeCloseTo(101.6)
    expect(parsed[7]).toBeCloseTo(25.4)
  })

  it('keys resource IDs numerically and accepts equivalent leading-zero references', () => {
    const archive = modelArchive(`
<model><resources>
  <object id="0001"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="00" v2="01" v3="02"/></triangles></mesh></object>
  <object id="0002"><components><component objectid="01"/></components></object>
</resources><build><item objectid="00002"/></build></model>`)

    expect(parseThreeMf(archive)).toHaveLength(9)
  })

  it('rejects numerically duplicate resource IDs', () => {
    const archive = modelArchive(`
<model><resources><object id="1"/><object id="01"/></resources><build><item objectid="1"/></build></model>`)

    expect(() => parseThreeMf(archive)).toThrow('duplicate 3MF resource id: 1')
  })

  it('enforces resource IDs across ignored and unreachable Core resources', () => {
    const duplicate = modelArchive(`
<model><resources>
  <basematerials id="1"><base name="PLA" displaycolor="#FFFFFFFF"/></basematerials>
  <object id="01"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>
</resources><build><item objectid="1"/></build></model>`)
    const invalid = modelArchive(`
<model><resources>
  <basematerials id="material"><base name="PLA" displaycolor="#FFFFFFFF"/></basematerials>
  <object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>
</resources><build><item objectid="1"/></build></model>`)

    expect(() => parseThreeMf(duplicate)).toThrow('duplicate 3MF resource id: 1')
    expect(() => parseThreeMf(invalid)).toThrow('invalid 3MF resource id: id')
  })

  it.each(['0', '-1', '1.0', '1e0', '0x1', 'object', '2147483648'])('rejects invalid resource ID syntax %s', (id) => {
    const archive = modelArchive(`<model><resources><object id="${id}"/></resources><build><item objectid="1"/></build></model>`)

    expect(() => parseThreeMf(archive)).toThrow('invalid 3MF resource id: id')
  })

  it('accepts leading plus signs for resource IDs and indices', () => {
    const archive = modelArchive(`<model><resources><object id="+1"><mesh><vertices>
      <vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/>
    </vertices><triangles><triangle v1="+0" v2="+1" v3="+2"/></triangles></mesh></object></resources><build><item objectid="+1"/></build></model>`)

    expect(parseThreeMf(archive)).toHaveLength(9)
  })

  it.each(['-1', '1.0', '1e0', '0x1', '2147483648'])('rejects invalid triangle resource index syntax %s', (index) => {
    const archive = modelArchive(`
<model><resources><object id="1"><mesh><vertices>
  <vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/>
</vertices><triangles><triangle v1="${index}" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>`)

    expect(() => parseThreeMf(archive)).toThrow('invalid 3MF index: v1')
  })

  it('decodes numeric character references in model attributes', () => {
    const archive = modelArchive(`
<model><resources><object id="&#49;"><mesh><vertices>
  <vertex x="&#x31;" y="0" z="0"/><vertex x="2" y="0" z="0"/><vertex x="1" y="1" z="0"/>
</vertices><triangles><triangle v1="&#48;" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="&#x31;"/></build></model>`)

    expect(Array.from(parseThreeMf(archive))).toEqual([1, 0, 0, 2, 0, 0, 1, 1, 0])
  })

  it('decodes predefined character references in OPC attributes', () => {
    const model = `
<model><resources><object id="1"><mesh><vertices>
  <vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/>
</vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>`
    const relationships = `
<Relationships><Relationship Id="rel-auto" Target="/3D/model&amp;part.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`
    const namespacedModel = model.replace('<model', '<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"')
    const archive = modelArchive(model, { '3D/model&part.model': strToU8(namespacedModel) }, relationships)

    expect(parseThreeMf(archive)).toHaveLength(9)
  })

  it.each(['model', 'solidsupport', 'support', 'surface'] as const)('accepts core %s mesh objects', (type) => {
    const archive = modelArchive(`<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>
      <object id="1" type="${type}"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>
    </resources><build><item objectid="1"/></build></model>`)

    expect(parseThreeMf(archive)).toHaveLength(9)
  })

  it.each(['solidsupport', 'support', 'surface', 'other', 'fixture'] as const)('ignores %s type on component containers', (type) => {
    const archive = modelArchive(`<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>
      <object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>
      <object id="2" type="${type}"><components><component objectid="1"/></components></object>
    </resources><build><item objectid="2"/></build></model>`)

    expect(parseThreeMf(archive, SUPPORTED_THREE_MF_PARSE_OPTIONS)).toHaveLength(9)
  })

  it.each(['pid', 'pindex'] as const)('rejects %s on component container objects before recursion', (attribute) => {
    const archive = modelArchive(`<model><resources>
      <object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>
      <object id="2" ${attribute}="1"><components><component objectid="1"/></components></object>
    </resources><build><item objectid="2"/></build></model>`)

    expect(() => parseThreeMf(archive, SUPPORTED_THREE_MF_PARSE_OPTIONS)).toThrow('core material assignments are not supported')
  })

  it('validates unqualified Core attributes while allowing qualified extension attributes', () => {
    const misspelled = modelArchive(`<model><resources>
      <object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>
      <object id="2"><components><component objectid="1" tranform="1 0 0 0 1 0 0 0 1 0 0 0"/></components></object>
    </resources><build><item objectid="2"/></build></model>`)
    const extension = modelArchive(`<model xmlns:vendor="https://vendor.example/3mf"><resources>
      <object id="1" vendor:label="leaf"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2" vendor:quality="draft"/></triangles></mesh></object>
      <object id="2"><components><component objectid="1" vendor:transform="preserved"/></components></object>
    </resources><build><item objectid="2" vendor:plate="one"/></build></model>`)

    expect(() => parseThreeMf(misspelled)).toThrow('unsupported Core attribute: tranform')
    expect(parseThreeMf(extension)).toHaveLength(9)
  })

  it('allows Core metadata type, model xml:lang, and extension namespace attributes', () => {
    const archive = modelArchive(`<model xml:lang="en-US" xmlns:vendor="https://vendor.example/3mf" vendor:profile="draft">
      <metadata name="Application" type="xs:string">PrintHub</metadata>
      <resources><object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2" vendor:quality="draft"/></triangles></mesh></object></resources>
      <build><item objectid="1"/></build></model>`)

    expect(parseThreeMf(archive)).toHaveLength(9)
  })

  it.each(reservedAttributeFixtures)('rejects reserved namespace fixture: $name', ({ model, error }) => {
    expect(() => parseThreeMf(modelArchive(model))).toThrow(error)
  })

  it('applies object-type inclusion to mesh leaves reached through components', () => {
    const archive = modelArchive(`<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>
      <object id="1" type="surface"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>
      <object id="2" type="surface"><components><component objectid="1"/></components></object>
    </resources><build><item objectid="2"/></build></model>`)

    expect(() => parseThreeMf(archive, SUPPORTED_THREE_MF_PARSE_OPTIONS)).toThrow('object type surface')
  })

  it('rejects reachable other meshes and invalid core object types', () => {
    const other = modelArchive(`<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>
      <object id="1" type="other"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>
    </resources><build><item objectid="1"/></build></model>`)
    const invalid = modelArchive(`<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>
      <object id="1" type="fixture"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>
    </resources><build><item objectid="1"/></build></model>`)

    expect(() => parseThreeMf(other)).toThrow('type other')
    expect(() => parseThreeMf(invalid)).toThrow('invalid core object type')
  })

  it('rejects missing vertices, declarations, and unsafe archive paths', () => {
    const missingVertex = modelArchive(`
<model><resources><object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/></vertices>
<triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>`)
    expect(() => parseThreeMf(missingVertex)).toThrow('references missing vertex 1')

    const duplicateVertex = modelArchive(`<model><resources><object id="1"><mesh><vertices>
<vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/>
</vertices><triangles><triangle v1="0" v2="1" v3="1"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>`)
    expect(() => parseThreeMf(duplicateVertex)).toThrow('duplicate vertex indices')

    const declaration = modelArchive(`<!DOCTYPE model [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<model><resources/><build/></model>`)
    expect(() => parseThreeMf(declaration)).toThrow('unsupported declarations')

    const traversal = modelArchive('<model><resources/><build/></model>', { '../outside.txt': strToU8('nope') })
    expect(() => parseThreeMf(traversal)).toThrow('unsafe archive path')
  })

  it('rejects custom references and DTD entity declarations', () => {
    const customReference = modelArchive(
      '<model unit="&custom;"><resources><object id="1"/></resources><build><item objectid="1"/></build></model>',
    )
    expect(() => parseThreeMf(customReference)).toThrow('unsupported XML entity reference: &custom;')

    const declaration = modelArchive(`<!DOCTYPE model [<!ENTITY custom "millimeter">]>
<model unit="&custom;"><resources><object id="1"/></resources><build><item objectid="1"/></build></model>`)
    expect(() => parseThreeMf(declaration)).toThrow('unsupported declarations')
  })

  it('rejects malformed XML and packages missing mandatory OPC metadata', () => {
    expect(() => parseThreeMf(modelArchive('<model><resources></model>'))).toThrow('invalid 3MF model XML')

    const missingContentTypes = unzipSync(modelArchive('<model><resources/><build/></model>'))
    delete missingContentTypes['[Content_Types].xml']
    expect(() => parseThreeMf(zipSync(missingContentTypes))).toThrow('[Content_Types].xml is missing')

    const wrongContentType = unzipSync(modelArchive('<model><resources/><build/></model>'))
    wrongContentType['[Content_Types].xml'] = strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="model" ContentType="application/xml"/></Types>',
    )
    expect(() => parseThreeMf(zipSync(wrongContentType))).toThrow('invalid or missing content type')
  })

  it('validates every OPC content-type mapping before selecting the model mapping', () => {
    const missingUnusedAttribute = unzipSync(modelArchive('<model><resources/><build/></model>'))
    missingUnusedAttribute['[Content_Types].xml'] = strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="png"/></Types>',
    )
    expect(() => parseThreeMf(zipSync(missingUnusedAttribute))).toThrow('missing 3MF attribute: ContentType')

    const malformedUnusedOverride = unzipSync(modelArchive('<model><resources/><build/></model>'))
    malformedUnusedOverride['[Content_Types].xml'] = strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Override PartName="unused.png" ContentType="image/png"/></Types>',
    )
    expect(() => parseThreeMf(zipSync(malformedUnusedOverride))).toThrow('must be an absolute part name')

    const duplicateDefault = unzipSync(modelArchive('<model><resources/><build/></model>'))
    duplicateDefault['[Content_Types].xml'] = strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="MODEL" ContentType="application/xml"/></Types>',
    )
    expect(() => parseThreeMf(zipSync(duplicateDefault))).toThrow('duplicate OPC Default mapping')

    const duplicateOverride = unzipSync(modelArchive('<model><resources/><build/></model>'))
    duplicateOverride['[Content_Types].xml'] = strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/3D/model.model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Override PartName="/3d/MODEL.MODEL" ContentType="application/xml"/></Types>',
    )
    expect(() => parseThreeMf(zipSync(duplicateOverride))).toThrow('duplicate OPC Override mapping')
  })

  it('matches 3MF model media types case-insensitively', () => {
    const archive = unzipSync(
      modelArchive(
        '<model><resources><object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>',
      ),
    )
    archive['[Content_Types].xml'] = strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="Application/Vnd.Openxmlformats-Package.Relationships+Xml"/><Default Extension="model" ContentType="Application/Vnd.Ms-Package.3Dmanufacturing-3Dmodel+Xml"/></Types>',
    )

    expect(parseThreeMf(zipSync(archive))).toHaveLength(9)
  })

  it.each([
    {
      name: 'unknown Core element',
      model:
        '<model><resources><object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object><unknown/></resources><build><item objectid="1"/></build></model>',
      error: 'unsupported Core element: unknown',
    },
    {
      name: 'misplaced Core element',
      model:
        '<model><resources><object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object><item objectid="1"/></resources><build><item objectid="1"/></build></model>',
      error: 'Core element item is not allowed inside resources',
    },
  ])('rejects $name', ({ model, error }) => {
    expect(() => parseThreeMf(modelArchive(model))).toThrow(error)
  })

  it('continues to ignore extension-namespace elements in otherwise valid Core content', () => {
    const archive = modelArchive(`<model xmlns:vendor="https://vendor.example/3mf"><resources>
      <object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>
      <vendor:unknown><item/><vendor:item/></vendor:unknown>
    </resources><build><item objectid="1"/></build></model>`)

    expect(parseThreeMf(archive)).toHaveLength(9)
  })

  it('tracks nested namespace scopes for prefixed Core and extension content', () => {
    const valid = modelArchive(`<c:model xmlns:c="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><c:resources>
      <c:object id="1"><c:mesh><c:vertices><c:vertex x="0" y="0" z="0"/><c:vertex x="1" y="0" z="0"/><c:vertex x="0" y="1" z="0"/></c:vertices><c:triangles><c:triangle v1="0" v2="1" v3="2"/></c:triangles></c:mesh></c:object>
      <vendor:data xmlns:vendor="https://vendor.example/3mf"><c:item xmlns:c="https://vendor.example/core"/><c:object xmlns:c="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" id="99"><vendor:ignored/></c:object></vendor:data>
    </c:resources><c:build><c:item objectid="1"/></c:build></c:model>`)
    const misplaced = modelArchive(`<c:model xmlns:c="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><c:resources>
      <c:object id="1"><c:mesh><c:vertices><c:vertex x="0" y="0" z="0"/><c:vertex x="1" y="0" z="0"/><c:vertex x="0" y="1" z="0"/></c:vertices><c:triangles><c:triangle v1="0" v2="1" v3="2"/></c:triangles></c:mesh></c:object>
      <c:item objectid="1"/>
    </c:resources><c:build><c:item objectid="1"/></c:build></c:model>`)

    expect(parseThreeMf(valid)).toHaveLength(9)
    expect(() => parseThreeMf(misplaced)).toThrow('Core element item is not allowed inside resources')
  })

  it('requires unique OPC Relationship IDs and required attributes', () => {
    const missingId = modelArchive(
      '<model><resources/><build/></model>',
      {},
      '<Relationships><Relationship Target="/3D/model.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
    )
    const duplicateId = modelArchive(
      '<model><resources/><build/></model>',
      {},
      `<Relationships>
      <Relationship Id="same" Target="ignored.model" Type="https://example.com/ignored"/>
      <Relationship Id="same" Target="/3D/model.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
    </Relationships>`,
    )
    const missingTarget = modelArchive(
      '<model><resources/><build/></model>',
      {},
      '<Relationships><Relationship Id="start" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
    )

    expect(() => parseThreeMf(missingId)).toThrow('missing 3MF attribute: Id')
    expect(() => parseThreeMf(duplicateId)).toThrow('duplicate OPC Relationship Id: same')
    expect(() => parseThreeMf(missingTarget)).toThrow('missing 3MF attribute: Target')
  })

  it.each([
    {
      name: 'dot segment in archive part name',
      archive: () => modelArchive('<model><resources/><build/></model>', { '3D/../other.model': strToU8('invalid') }),
      error: 'unsafe archive path',
    },
    {
      name: 'dot segment in relationship target',
      archive: () =>
        modelArchive(
          '<model><resources/><build/></model>',
          {},
          '<Relationships><Relationship Id="start" Target="3D/../model.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
        ),
      error: 'unsafe 3MF model target',
    },
    {
      name: 'raw space in relationship target',
      archive: () =>
        modelArchive(
          '<model><resources/><build/></model>',
          {},
          '<Relationships><Relationship Id="start" Target="3D/my model.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
        ),
      error: 'invalid 3MF model target',
    },
    {
      name: 'raw Unicode in override part name',
      archive: () => {
        const archive = unzipSync(modelArchive('<model><resources/><build/></model>'))
        archive['[Content_Types].xml'] = strToU8(
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/3D/mödel.model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
        )
        return zipSync(archive)
      },
      error: 'invalid 3MF model target',
    },
  ])('rejects official-style OPC part-name negative: $name', ({ archive, error }) => {
    expect(() => parseThreeMf(archive())).toThrow(error)
  })

  it('validates the root relationships part content type', () => {
    const archive = unzipSync(modelArchive('<model><resources/><build/></model>'))
    archive['[Content_Types].xml'] = strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/octet-stream"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
    )

    expect(() => parseThreeMf(zipSync(archive))).toThrow('root relationships part has an invalid or missing content type')
  })

  it.each([
    {
      name: 'invalid XML ID',
      relationships:
        '<Relationships><Relationship Id="1start" Target="/3D/model.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
      error: 'invalid OPC Relationship Id',
    },
    {
      name: 'missing relationship type',
      relationships: '<Relationships><Relationship Id="start" Target="/3D/model.model"/></Relationships>',
      error: 'missing 3MF attribute: Type',
    },
    {
      name: 'external non-StartPart relationship',
      relationships: `<Relationships>
        <Relationship Id="external" Target="https://example.com/thumbnail.png" TargetMode="External" Type="https://example.com/thumbnail"/>
        <Relationship Id="start" Target="/3D/model.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
      </Relationships>`,
      error: 'unsupported OPC Relationship TargetMode: External',
    },
    {
      name: 'missing internal target',
      relationships: `<Relationships>
        <Relationship Id="missing" Target="/Metadata/missing.xml" Type="https://example.com/metadata"/>
        <Relationship Id="start" Target="/3D/model.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
      </Relationships>`,
      error: 'OPC relationship target is missing: Metadata/missing.xml',
    },
  ])('rejects official-style OPC relationship negative: $name', ({ relationships, error }) => {
    expect(() => parseThreeMf(modelArchive('<model><resources/><build/></model>', {}, relationships))).toThrow(error)
  })

  it('validates unused base material entries', () => {
    const valid = modelArchive(`<model><resources>
      <basematerials id="1"><base name="PLA" displaycolor="#abcDEF"/><base name="PETG" displaycolor="#11223344"/></basematerials>
      <object id="2"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>
    </resources><build><item objectid="2"/></build></model>`)
    const missingName = modelArchive(
      `<model><resources><basematerials id="1"><base displaycolor="#112233"/></basematerials><object id="2"/></resources><build><item objectid="2"/></build></model>`,
    )
    const invalidColor = modelArchive(
      `<model><resources><basematerials id="1"><base name="PLA" displaycolor="red"/></basematerials><object id="2"/></resources><build><item objectid="2"/></build></model>`,
    )
    const empty = modelArchive(
      `<model><resources><basematerials id="1"/><object id="2"/></resources><build><item objectid="2"/></build></model>`,
    )
    const missingColor = modelArchive(
      `<model><resources><basematerials id="1"><base name="PLA"/></basematerials><object id="2"/></resources><build><item objectid="2"/></build></model>`,
    )

    expect(parseThreeMf(valid)).toHaveLength(9)
    expect(() => parseThreeMf(missingName)).toThrow('missing 3MF attribute: name')
    expect(() => parseThreeMf(invalidColor)).toThrow('invalid 3MF displaycolor')
    expect(() => parseThreeMf(empty)).toThrow('must contain at least one base')
    expect(() => parseThreeMf(missingColor)).toThrow('missing 3MF attribute: displaycolor')
  })

  it('validates Core metadata names, preserve values, and groups', () => {
    const geometry =
      '<resources><object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build>'
    const invalidName = modelArchive(`<model><metadata name="invalid name">value</metadata>${geometry}</model>`)
    const undeclaredPrefix = modelArchive(`<model><metadata name="vendor:name">value</metadata>${geometry}</model>`)
    const invalidPreserve = modelArchive(`<model><metadata name="Application" preserve="yes">value</metadata>${geometry}</model>`)
    const emptyGroup = modelArchive(
      `<model><resources><object id="1"><metadatagroup/><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>`,
    )
    const valid = modelArchive(
      `<model xmlns:vendor="https://example.com/metadata"><metadata name="vendor:name" preserve="1">value</metadata>${geometry}</model>`,
    )

    expect(() => parseThreeMf(invalidName)).toThrow('invalid 3MF metadata QName')
    expect(() => parseThreeMf(undeclaredPrefix)).toThrow('undeclared prefix')
    expect(() => parseThreeMf(invalidPreserve)).toThrow('invalid 3MF metadata preserve boolean')
    expect(() => parseThreeMf(emptyGroup)).toThrow('must contain at least one metadata element')
    expect(parseThreeMf(valid)).toHaveLength(9)
  })

  it.each([
    {
      name: 'model siblings',
      model: `<model><metadata name="Application">one</metadata><metadata name="Application">two</metadata><resources><object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>`,
      scope: 'model',
    },
    {
      name: 'object metadata group',
      model: `<model><resources><object id="1"><metadatagroup><metadata name="Title">one</metadata><metadata name="Title">two</metadata></metadatagroup><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>`,
      scope: 'metadatagroup',
    },
    {
      name: 'build item metadata group',
      model: `<model><resources><object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"><metadatagroup><metadata name="Title">one</metadata><metadata name="Title">two</metadata></metadatagroup></item></build></model>`,
      scope: 'metadatagroup',
    },
  ])('rejects duplicate Core metadata names among $name', ({ model, scope }) => {
    expect(() => parseThreeMf(modelArchive(model))).toThrow(`duplicate 3MF metadata name in ${scope}`)
  })

  it('requires the OPC and 3MF core namespaces', () => {
    const wrongRelationships = modelArchive(
      '<model><resources/><build/></model>',
      {},
      '<Relationships xmlns="https://example.com/relationships"><Relationship Id="rel-auto" Target="/3D/model.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
    )
    expect(() => parseThreeMf(wrongRelationships)).toThrow('unsupported Relationships namespace')

    const wrongModel = modelArchive('<model xmlns="https://example.com/core"><resources/><build/></model>')
    expect(() => parseThreeMf(wrongModel)).toThrow('unsupported model namespace')
  })

  it('does not consume unprefixed vendor-default elements as core geometry', () => {
    expect(() => parseThreeMf(modelArchive(vendorDefaultNamespaceModel))).toThrow('model resources is missing or malformed')
  })

  it('uses the internal StartPart relationship and supports package-relative targets', () => {
    const model =
      '<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>'
    const relationships = `<?xml version="1.0"?><Relationships>
      <Relationship Id="ignored" Target="3D/ignored.model" Type="https://example.com/not-a-start-part"/>
      <Relationship Id="start" Target="Models/main.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
    </Relationships>`
    const archive = modelArchive(model, { 'Models/main.model': strToU8(model), '3D/ignored.model': strToU8('invalid') }, relationships)

    expect(parseThreeMf(archive)).toHaveLength(9)

    const external = modelArchive(
      model,
      {},
      '<?xml version="1.0"?><Relationships><Relationship Id="rel-auto" Target="https://example.com/model.model" TargetMode="External" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
    )
    expect(() => parseThreeMf(external)).toThrow('unsupported OPC Relationship TargetMode: External')
  })

  it('requires absolute OPC Override part names without changing relationship target rules', () => {
    const archive = unzipSync(modelArchive('<model><resources/><build/></model>'))
    archive['[Content_Types].xml'] = strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="3D/model.model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
    )

    expect(() => parseThreeMf(zipSync(archive))).toThrow('OPC Override PartName must be an absolute part name')
  })

  it('resolves percent-encoded OPC part names without decoding the ZIP entry name', () => {
    const model =
      '<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>'
    const archive = zipSync({
      '[Content_Types].xml': strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/3D/My%20Model.model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
      ),
      '_rels/.rels': strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rel-auto" Target="/3D/My%20Model.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
      ),
      '3D/My%20Model.model': strToU8(model),
    })

    expect(parseThreeMf(archive)).toHaveLength(9)
  })

  it('matches OPC overrides with the archive canonical case-insensitive key', () => {
    const model =
      '<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>'
    const archive = zipSync({
      '[Content_Types].xml': strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/3d/MY%20MODEL.MODEL" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
      ),
      '_rels/.rels': strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rel-auto" Target="/3D/My%20Model.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
      ),
      '3d/my%20model.MODEL': strToU8(model),
    })

    expect(parseThreeMf(archive)).toHaveLength(9)
  })

  it('rejects required extensions and Production Extension cross-model references', () => {
    const required = modelArchive(`
<model xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">
  <resources><object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build>
</model>`)
    expect(() => parseThreeMf(required)).toThrow('requires unsupported extensions: p')

    const crossModel = modelArchive(`
<model xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
  <resources>
    <object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>
    <object id="2"><components><component objectid="1" p:path="/3D/child.model"/></components></object>
  </resources><build><item objectid="2"/></build>
</model>`)
    expect(() => parseThreeMf(crossModel)).toThrow('Production Extension cross-model references are not supported')
  })

  it('corrects winding for reflected transforms', () => {
    const archive = modelArchive(`
<model><resources><object id="1"><mesh><vertices>
  <vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/>
</vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources>
<build><item objectid="1" transform="-1 0 0 0 1 0 0 0 1 0 0 0"/></build></model>`)

    expect([...parseThreeMf(archive)]).toEqual([0, 0, 0, 0, 1, 0, -1, 0, 0])
  })

  it('accepts the 3MF decimal and exponent grammar for coordinates and transforms', () => {
    const archive = modelArchive(`
<model><resources><object id="1"><mesh><vertices>
  <vertex x="+.5" y="-1.25e+1" z="2E-1"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/>
</vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources>
<build><item objectid="1" transform="1e0 0 0 0 1 0 0 0 1 2.5e1 -.5 +.25"/></build></model>`)

    expect([...parseThreeMf(archive)].slice(0, 3)).toEqual([25.5, -13, 0.44999998807907104])
  })

  it.each(['0x10', '1.', 'Infinity', 'NaN'])('rejects non-3MF coordinate syntax %s', (coordinate) => {
    const archive = modelArchive(`
<model><resources><object id="1"><mesh><vertices>
  <vertex x="${coordinate}" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/>
</vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>`)

    expect(() => parseThreeMf(archive)).toThrow('invalid 3MF number: x')
  })

  it.each(['0x1', '1.', 'Infinity', 'NaN'])('rejects non-3MF transform syntax %s', (component) => {
    const archive = modelArchive(`
<model><resources><object id="1"><mesh><vertices>
  <vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/>
</vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources>
<build><item objectid="1" transform="${component} 0 0 0 1 0 0 0 1 0 0 0"/></build></model>`)

    expect(() => parseThreeMf(archive)).toThrow('invalid 3MF transform')
  })

  it('rejects coordinates that overflow Float32 after scaling', () => {
    const archive = modelArchive(`
<model unit="meter"><resources><object id="1"><mesh><vertices>
  <vertex x="1e38" y="0" z="0"/><vertex x="0" y="0" z="0"/><vertex x="0" y="1" z="0"/>
</vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>`)

    expect(() => parseThreeMf(archive)).toThrow('coordinates exceed Float32 range')
  })

  it('rejects XML beyond the configured depth budget', () => {
    const nested = `${'<extra>'.repeat(40)}${'</extra>'.repeat(40)}`
    expect(() => parseThreeMf(modelArchive(`<model>${nested}<resources/><build/></model>`))).toThrow()
  })

  it('round-trips PrintHub plate exports', () => {
    const archive = exportPlate3mf([placement('copy-1')], new Map([['request-1', { name: 'Model', positions }]]))
    expect(parseThreeMf(archive)).toHaveLength(positions.length)
  })
})
