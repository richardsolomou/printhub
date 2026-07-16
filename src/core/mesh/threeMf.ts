import { strToU8, unzipSync, zipSync, type UnzipFileInfo } from 'fflate'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import * as THREE from 'three'
import type { PlatePlacement } from '../platePlanner'

const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024
const MAX_UNCOMPRESSED_BYTES = 256 * 1024 * 1024
const MAX_MODEL_BYTES = 64 * 1024 * 1024
const MAX_RELATIONSHIPS_BYTES = 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 256
const MAX_TRIANGLES = 1_000_000
const MAX_VERTICES = 1_000_000
const MAX_FLOAT32 = 3.4028234663852886e38
const MAX_RESOURCE_INTEGER = 2 ** 31
const START_PART_RELATIONSHIP = 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel'
const THREE_MF_NUMBER = /^[+-]?(?:(?:\d+(?:\.\d+)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/
const THREE_MF_INTEGER = /^\+?\d+$/

export const THREE_MF_UPLOAD_LIMITS = {
  archiveBytes: MAX_ARCHIVE_BYTES,
  uncompressedBytes: MAX_UNCOMPRESSED_BYTES,
  modelBytes: MAX_MODEL_BYTES,
  entries: MAX_ARCHIVE_ENTRIES,
  triangles: MAX_TRIANGLES,
} as const

type XmlNode = Record<string, unknown>
type Transform = readonly [number, number, number, number, number, number, number, number, number, number, number, number]
type ArchiveEntry = { name: string; size: number }

const identityTransform: Transform = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]
const unitScaleMm: Record<string, number> = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1000,
}

export function parseThreeMf(file: Uint8Array): Float32Array {
  if (file.byteLength > MAX_ARCHIVE_BYTES) throw new Error(`3MF archive exceeds the ${formatMiB(MAX_ARCHIVE_BYTES)} limit`)
  const archive = readArchive(file)
  const relationships = parseXml(archive.relationships, '3MF package relationships')
  const startParts = arrayOf(node(relationships.Relationships, 'Relationships').Relationship).filter(
    (relationship) => stringAttribute(relationship, 'Type') === START_PART_RELATIONSHIP,
  )
  if (startParts.length !== 1) throw new Error('3MF package must define one StartPart relationship')
  const modelPath = safeArchiveTarget(stringAttribute(startParts[0], 'Target'))
  const modelEntry = archive.entries.get(modelPath.toLowerCase())
  if (!modelEntry) throw new Error(`3MF model part is missing: ${modelPath}`)
  if (modelEntry.size > MAX_MODEL_BYTES) throw new Error(`${modelEntry.name} exceeds the allowed 3MF model-part size`)
  return parseModel(extractArchiveEntry(file, modelEntry))
}

function readArchive(file: Uint8Array) {
  let entryCount = 0
  let uncompressedBytes = 0
  const seen = new Set<string>()
  const entries = new Map<string, ArchiveEntry>()
  let extracted: Record<string, Uint8Array>
  try {
    extracted = unzipSync(file, {
      filter: (entry) => {
        const name = validateArchiveEntry(entry, seen)
        entryCount++
        uncompressedBytes += entry.originalSize
        if (entryCount > MAX_ARCHIVE_ENTRIES) throw new Error(`3MF archive contains more than ${MAX_ARCHIVE_ENTRIES} entries`)
        if (uncompressedBytes > MAX_UNCOMPRESSED_BYTES)
          throw new Error(`3MF archive expands beyond the ${formatMiB(MAX_UNCOMPRESSED_BYTES)} limit`)
        entries.set(name.toLowerCase(), { name: entry.name, size: entry.originalSize })
        if (name.toLowerCase() === '_rels/.rels' && entry.originalSize > MAX_RELATIONSHIPS_BYTES)
          throw new Error(`${entry.name} exceeds the allowed 3MF relationships size`)
        return name.toLowerCase() === '_rels/.rels'
      },
    })
  } catch (error) {
    throw new Error(`invalid 3MF archive: ${errorMessage(error)}`, { cause: error })
  }
  const relationships = Object.entries(extracted).find(([name]) => name.toLowerCase() === '_rels/.rels')?.[1]
  if (!relationships) throw new Error('3MF package relationships are missing')
  return { entries, relationships }
}

function validateArchiveEntry(entry: UnzipFileInfo, seen: Set<string>) {
  if (entry.compression !== 0 && entry.compression !== 8) throw new Error(`unsupported ZIP compression in ${entry.name}`)
  if (!entry.name || entry.name.includes('\\') || entry.name.includes('\0') || entry.name.startsWith('/'))
    throw new Error(`unsafe archive path: ${entry.name || '(empty)'}`)
  const segments = entry.name.split('/')
  if (segments.some((segment) => segment === '..' || segment === '.') || /^[a-z]:/i.test(entry.name))
    throw new Error(`unsafe archive path: ${entry.name}`)
  const key = entry.name.toLowerCase()
  if (seen.has(key)) throw new Error(`duplicate archive entry: ${entry.name}`)
  seen.add(key)
  return entry.name
}

function safeArchiveTarget(target: string) {
  const normalized = target.replace(/^\//, '')
  if (
    !normalized ||
    normalized.includes('\\') ||
    normalized.includes('?') ||
    normalized.includes('#') ||
    normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..') ||
    /^[a-z][a-z\d+.-]*:/i.test(normalized)
  )
    throw new Error(`unsafe 3MF model target: ${target}`)
  return normalized
}

function extractArchiveEntry(file: Uint8Array, selected: ArchiveEntry) {
  try {
    const extracted = unzipSync(file, { filter: (entry) => entry.name.toLowerCase() === selected.name.toLowerCase() })
    const bytes = Object.entries(extracted).find(([name]) => name.toLowerCase() === selected.name.toLowerCase())?.[1]
    if (!bytes || bytes.byteLength !== selected.size) throw new Error(`archive entry is missing or changed: ${selected.name}`)
    return bytes
  } catch (error) {
    throw new Error(`invalid 3MF archive: ${errorMessage(error)}`, { cause: error })
  }
}

function parseModel(bytes: Uint8Array) {
  const document = parseXml(bytes, '3MF model')
  const model = node(document.model, '3MF model')
  const requiredExtensions = optionalStringAttribute(model, 'requiredextensions')
  if (requiredExtensions) throw new Error(`3MF model requires unsupported extensions: ${requiredExtensions}`)
  const scale = unitScaleMm[stringAttribute(model, 'unit', 'millimeter').toLowerCase()]
  if (!scale) throw new Error(`unsupported 3MF unit: ${String(model.unit)}`)
  const resources = node(model.resources, 'model resources')
  const objects = new Map<number, XmlNode>()
  for (const object of arrayOf(resources.object)) {
    const id = resourceIdAttribute(object, 'id')
    if (objects.has(id)) throw new Error(`duplicate 3MF object id: ${id}`)
    objects.set(id, object)
  }
  if (!objects.size) throw new Error('3MF model contains no objects')
  const items = arrayOf(node(model.build, 'model build').item)
  if (!items.length) throw new Error('3MF model contains no build items')
  const output: number[] = []
  for (const item of items) {
    rejectExternalReference(item)
    appendObject(resourceIdAttribute(item, 'objectid'), parseTransform(item.transform), objects, new Set(), output)
  }
  if (!output.length) throw new Error('3MF model contains no triangles')
  const positions = new Float32Array(output.length)
  for (let index = 0; index < output.length; index++) {
    const value = output[index] * scale
    if (!Number.isFinite(value) || Math.abs(value) > MAX_FLOAT32) throw new Error('3MF coordinates exceed Float32 range after unit scaling')
    positions[index] = value
  }
  return positions
}

function appendObject(id: number, transform: Transform, objects: Map<number, XmlNode>, parents: Set<number>, output: number[]) {
  if (parents.has(id)) throw new Error(`cyclic 3MF component reference: ${id}`)
  const object = objects.get(id)
  if (!object) throw new Error(`3MF object does not exist: ${id}`)
  rejectMaterialAssignments(object)
  const type = optionalStringAttribute(object, 'type') ?? 'model'
  if (type !== 'model') throw new Error(`3MF object type ${type} is not supported`)
  const mesh = optionalNode(object.mesh)
  const components = optionalNode(object.components)
  if (!!mesh === !!components) throw new Error(`3MF object ${id} must contain either a mesh or components`)
  if (mesh) {
    appendMesh(mesh, transform, output)
    return
  }
  const nextParents = new Set(parents).add(id)
  const componentList = arrayOf(components!.component)
  if (!componentList.length) throw new Error(`3MF component object ${id} is empty`)
  for (const component of componentList) {
    rejectExternalReference(component)
    appendObject(
      resourceIdAttribute(component, 'objectid'),
      multiplyTransforms(transform, parseTransform(component.transform)),
      objects,
      nextParents,
      output,
    )
  }
}

function rejectMaterialAssignments(object: XmlNode) {
  if (hasAnyAttribute(object, ['pid', 'pindex'])) throw new Error('3MF material assignments are not supported')
  const mesh = optionalNode(object.mesh)
  for (const triangle of arrayOf(optionalNode(mesh?.triangles)?.triangle)) {
    if (hasAnyAttribute(triangle, ['pid', 'p1', 'p2', 'p3'])) throw new Error('3MF material assignments are not supported')
  }
}

function hasAnyAttribute(element: XmlNode, names: readonly string[]) {
  return names.some((name) => Object.hasOwn(element, name))
}

function rejectExternalReference(element: XmlNode) {
  if (Object.keys(element).some((name) => name === 'path' || name.endsWith(':path')))
    throw new Error('3MF cross-model references are not supported')
}

function appendMesh(mesh: XmlNode, transform: Transform, output: number[]) {
  const vertices = arrayOf(node(mesh.vertices, 'mesh vertices').vertex)
  const triangles = arrayOf(node(mesh.triangles, 'mesh triangles').triangle)
  if (!vertices.length || vertices.length > MAX_VERTICES) throw new Error(`3MF mesh has an invalid vertex count: ${vertices.length}`)
  const points = vertices.map(
    (vertex) => [numberAttribute(vertex, 'x'), numberAttribute(vertex, 'y'), numberAttribute(vertex, 'z')] as const,
  )
  const attributes = transformDeterminant(transform) < 0 ? (['v1', 'v3', 'v2'] as const) : (['v1', 'v2', 'v3'] as const)
  for (const triangle of triangles) {
    const indices = attributes.map((attribute) => resourceIndexAttribute(triangle, attribute))
    if (new Set(indices).size !== 3) throw new Error('3MF triangle contains duplicate vertex indices')
    for (const index of indices) {
      const point = points[index]
      if (!point) throw new Error(`3MF triangle references missing vertex ${index}`)
      output.push(...transformPoint(transform, point))
    }
    if (output.length / 9 > MAX_TRIANGLES) throw new Error(`3MF model exceeds the ${MAX_TRIANGLES.toLocaleString()} triangle limit`)
  }
}

function transformDeterminant(transform: Transform) {
  return (
    transform[0] * (transform[4] * transform[8] - transform[5] * transform[7]) -
    transform[3] * (transform[1] * transform[8] - transform[2] * transform[7]) +
    transform[6] * (transform[1] * transform[5] - transform[2] * transform[4])
  )
}

function parseTransform(value: unknown): Transform {
  if (value === undefined) return identityTransform
  if (typeof value !== 'string') throw new Error('invalid 3MF transform')
  const tokens = value.trim().split(/\s+/)
  if (tokens.length !== 12 || tokens.some((token) => !THREE_MF_NUMBER.test(token))) throw new Error(`invalid 3MF transform: ${value}`)
  const transform = tokens.map(Number)
  if (transform.some((item) => !Number.isFinite(item))) throw new Error(`invalid 3MF transform: ${value}`)
  return transform as unknown as Transform
}

function multiplyTransforms(outer: Transform, inner: Transform): Transform {
  const basis = [
    transformVector(outer, [inner[0], inner[1], inner[2]]),
    transformVector(outer, [inner[3], inner[4], inner[5]]),
    transformVector(outer, [inner[6], inner[7], inner[8]]),
  ]
  const translation = transformPoint(outer, [inner[9], inner[10], inner[11]])
  return [...basis[0], ...basis[1], ...basis[2], ...translation] as Transform
}

function transformPoint(transform: Transform, point: readonly [number, number, number]) {
  const [x, y, z] = transformVector(transform, point)
  return [x + transform[9], y + transform[10], z + transform[11]] as const
}

function transformVector(transform: Transform, [x, y, z]: readonly [number, number, number]) {
  return [
    transform[0] * x + transform[3] * y + transform[6] * z,
    transform[1] * x + transform[4] * y + transform[7] * z,
    transform[2] * x + transform[5] * y + transform[8] * z,
  ] as const
}

function parseXml(bytes: Uint8Array, label: string): XmlNode {
  let xml: string
  try {
    xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    throw new Error(`invalid ${label} UTF-8 encoding`, { cause: error })
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error(`${label} contains unsupported declarations`)
  const validation = XMLValidator.validate(xml)
  if (validation !== true) throw new Error(`invalid ${label} XML: ${validation.err.msg}`)
  try {
    return node(
      new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '',
        removeNSPrefix: true,
        parseTagValue: false,
        parseAttributeValue: false,
        processEntities: false,
        maxNestedTags: 32,
        isArray: (name) => ['Relationship', 'object', 'vertex', 'triangle', 'component', 'item'].includes(name),
        transformAttributeName: (name) => name.toLowerCase(),
      }).parse(xml),
      label,
    )
  } catch (error) {
    throw new Error(`invalid ${label} XML: ${errorMessage(error)}`, { cause: error })
  }
}

function node(value: unknown, label: string): XmlNode {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is missing or malformed`)
  return value as XmlNode
}

function optionalNode(value: unknown): XmlNode | undefined {
  return value === undefined ? undefined : node(value, '3MF element')
}

function arrayOf(value: unknown): XmlNode[] {
  if (value === undefined) return []
  return (Array.isArray(value) ? value : [value]).map((item) => node(item, '3MF element'))
}

function stringAttribute(element: XmlNode, name: string, fallback?: string) {
  const value = element[name.toLowerCase()]
  if (value === undefined && fallback !== undefined) return fallback
  if (typeof value !== 'string' || !value.trim()) throw new Error(`missing 3MF attribute: ${name}`)
  return value.trim()
}

function optionalStringAttribute(element: XmlNode, name: string) {
  const value = element[name.toLowerCase()]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`invalid 3MF attribute: ${name}`)
  return value.trim() || undefined
}

function numberAttribute(element: XmlNode, name: string) {
  const lexicalValue = stringAttribute(element, name)
  if (!THREE_MF_NUMBER.test(lexicalValue)) throw new Error(`invalid 3MF number: ${name}`)
  const value = Number(lexicalValue)
  if (!Number.isFinite(value)) throw new Error(`invalid 3MF number: ${name}`)
  return value
}

function resourceIdAttribute(element: XmlNode, name: string) {
  const value = resourceIndexAttribute(element, name)
  if (value === 0) throw new Error(`invalid 3MF resource id: ${name}`)
  return value
}

function resourceIndexAttribute(element: XmlNode, name: string) {
  const lexicalValue = stringAttribute(element, name)
  if (!THREE_MF_INTEGER.test(lexicalValue)) throw new Error(`invalid 3MF index: ${name}`)
  const value = Number(lexicalValue)
  if (!Number.isInteger(value) || value >= MAX_RESOURCE_INTEGER) throw new Error(`invalid 3MF index: ${name}`)
  return value
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function formatMiB(bytes: number) {
  return `${bytes / 1024 / 1024} MiB`
}

function isValidXmlCharacter(codePoint: number) {
  return (
    codePoint === 0x9 ||
    codePoint === 0xa ||
    codePoint === 0xd ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  )
}
export type ThreeMfMesh = {
  name: string
  positions: Float32Array
}

export function exportPlate3mf(placements: PlatePlacement[], meshes: Map<string, ThreeMfMesh>): Uint8Array {
  const requestIds = [...new Set(placements.map((placement) => placement.requestId))]
  const objectIds = new Map(requestIds.map((requestId, index) => [requestId, index + 1]))
  const objects = requestIds.map((requestId) => {
    const mesh = meshes.get(requestId)
    if (!mesh) {
      const placement = placements.find((candidate) => candidate.requestId === requestId)
      throw new Error(`Missing original mesh for ${placement?.name ?? requestId}`)
    }
    return objectXml(objectIds.get(requestId)!, mesh)
  })
  const items = placements.map((placement) => {
    const mesh = meshes.get(placement.requestId)
    if (!mesh) throw new Error(`Missing original mesh for ${placement.name}`)
    return `    <item objectid="${objectIds.get(placement.requestId)}" transform="${placementTransform(placement, mesh.positions)}" />`
  })
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Application">PrintHub</metadata>
  <resources>
${objects.join('\n')}
  </resources>
  <build>
${items.join('\n')}
  </build>
</model>`

  return zipSync(
    {
      '[Content_Types].xml': strToU8(contentTypesXml),
      '_rels/.rels': strToU8(relationshipsXml),
      '3D/3dmodel.model': strToU8(model),
    },
    { level: 6 },
  )
}

function objectXml(id: number, mesh: ThreeMfMesh) {
  const indexed = indexPositions(mesh.positions)
  const vertices = indexed.vertices.map(
    ([x, y, z]) => `          <vertex x="${formatNumber(x)}" y="${formatNumber(y)}" z="${formatNumber(z)}" />`,
  )
  const triangles = indexed.triangles.map(([v1, v2, v3]) => `          <triangle v1="${v1}" v2="${v2}" v3="${v3}" />`)
  return `    <object id="${id}" type="model" name="${escapeXml(mesh.name)}">
      <mesh>
        <vertices>
${vertices.join('\n')}
        </vertices>
        <triangles>
${triangles.join('\n')}
        </triangles>
      </mesh>
    </object>`
}

function indexPositions(positions: Float32Array) {
  if (positions.length === 0 || positions.length % 9 !== 0) throw new Error('Original mesh does not contain complete triangles')
  const vertices: [number, number, number][] = []
  const triangles: [number, number, number][] = []
  const indices = new Map<string, number>()
  for (let offset = 0; offset < positions.length; offset += 9) {
    const triangle: [number, number, number] = [0, 0, 0]
    for (let vertex = 0; vertex < 3; vertex++) {
      const index = offset + vertex * 3
      const point: [number, number, number] = [positions[index], positions[index + 1], positions[index + 2]]
      if (!point.every(Number.isFinite)) throw new Error('Original mesh contains invalid coordinates')
      const key = point.join('|')
      let vertexIndex = indices.get(key)
      if (vertexIndex === undefined) {
        vertexIndex = vertices.length
        vertices.push(point)
        indices.set(key, vertexIndex)
      }
      triangle[vertex] = vertexIndex
    }
    triangles.push(triangle)
  }
  return { vertices, triangles }
}

function placementTransform(placement: PlatePlacement, positions: Float32Array) {
  const orientation = new THREE.Quaternion(...(placement.orientationQuaternion ?? [0, 0, 0, 1]))
  const bounds = new THREE.Box3()
  const point = new THREE.Vector3()
  for (let index = 0; index < positions.length; index += 3) {
    point.set(positions[index], positions[index + 1], positions[index + 2]).applyQuaternion(orientation)
    bounds.expandByPoint(point)
  }
  const plateRotation = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1),
    THREE.MathUtils.degToRad(placement.rotationZDegrees),
  )
  const rotatedCenter = bounds.getCenter(new THREE.Vector3()).applyQuaternion(plateRotation)
  const position = new THREE.Vector3(placement.xMm - rotatedCenter.x, placement.yMm - rotatedCenter.y, -bounds.min.z)
  const rotation = plateRotation.multiply(orientation)
  const elements = new THREE.Matrix4().compose(position, rotation, new THREE.Vector3(1, 1, 1)).elements
  return [
    elements[0],
    elements[1],
    elements[2],
    elements[4],
    elements[5],
    elements[6],
    elements[8],
    elements[9],
    elements[10],
    elements[12],
    elements[13],
    elements[14],
  ]
    .map(formatNumber)
    .join(' ')
}

function formatNumber(value: number) {
  if (Math.abs(value) < 1e-9) return '0'
  return value.toFixed(9).replace(/\.?0+$/, '')
}

function escapeXml(value: string) {
  let sanitized = ''
  for (const character of value) sanitized += isValidXmlCharacter(character.codePointAt(0)!) ? character : '\ufffd'
  return sanitized
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

const contentTypesXml = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
</Types>`

const relationshipsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`
