import { strToU8, unzipSync, zipSync, type UnzipFileInfo } from 'fflate'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import * as THREE from 'three'
import type { PlatePlacement } from '../platePlanner'

const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024
const MAX_UNCOMPRESSED_BYTES = 256 * 1024 * 1024
const MAX_MODEL_BYTES = 64 * 1024 * 1024
const MAX_RELATIONSHIPS_BYTES = 1024 * 1024
const MAX_CONTENT_TYPES_BYTES = 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 256
const MAX_TRIANGLES = 1_000_000
const MAX_VERTICES = 1_000_000
const MAX_XML_DEPTH = 32
const MAX_MODEL_XML_NODES = 2_100_000
const MAX_MODEL_XML_ATTRIBUTES = 6_100_000
const MAX_RELATIONSHIP_XML_NODES = 128
const MAX_RELATIONSHIP_XML_ATTRIBUTES = 1024
const MAX_ATTRIBUTES_PER_ELEMENT = 32
const MAX_FLOAT32 = 3.4028234663852886e38
const MAX_RESOURCE_INTEGER = 2 ** 31
const THREE_MF_NUMBER = /^[+-]?(?:(?:\d+(?:\.\d+)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/
const THREE_MF_INTEGER = /^\+?\d+$/
const THREE_MF_COLOR = /^#[\da-fA-F]{6}(?:[\da-fA-F]{2})?$/
const XML_QNAME = /^[\p{L}_][\p{L}\p{N}_.-]*(?::[\p{L}_][\p{L}\p{N}_.-]*)?$/u
const XML_ID = /^[\p{L}_][\p{L}\p{N}_.-]*$/u
const XML_BOOLEAN = /^(?:true|false|0|1)$/
const PREDEFINED_XML_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  quot: '"',
}
const START_PART_RELATIONSHIP = 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel'
const CORE_NAMESPACE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02'
const RELATIONSHIPS_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/relationships'
const CONTENT_TYPES_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/content-types'
const MODEL_CONTENT_TYPE = 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml'
const RELATIONSHIPS_CONTENT_TYPE = 'application/vnd.openxmlformats-package.relationships+xml'
const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace'
const XML_SCHEMA_INSTANCE_NAMESPACE = 'http://www.w3.org/2001/XMLSchema-instance'

const CORE_ELEMENT_ATTRIBUTES: Record<string, ReadonlySet<string>> = {
  model: new Set(['unit', 'requiredextensions', 'recommendedextensions']),
  resources: new Set(),
  object: new Set(['id', 'type', 'thumbnail', 'partnumber', 'name', 'pid', 'pindex']),
  mesh: new Set(),
  vertices: new Set(),
  vertex: new Set(['x', 'y', 'z']),
  triangles: new Set(),
  triangle: new Set(['v1', 'v2', 'v3', 'pid', 'p1', 'p2', 'p3']),
  components: new Set(),
  component: new Set(['objectid', 'transform']),
  build: new Set(),
  item: new Set(['objectid', 'transform', 'partnumber']),
  basematerials: new Set(['id']),
  base: new Set(['name', 'displaycolor']),
  metadatagroup: new Set(),
  metadata: new Set(['name', 'preserve', 'type']),
}
const CORE_ELEMENT_CHILDREN: Record<string, ReadonlySet<string>> = {
  model: new Set(['metadata', 'resources', 'build']),
  metadata: new Set(),
  resources: new Set(['basematerials', 'object']),
  basematerials: new Set(['base']),
  base: new Set(),
  object: new Set(['metadatagroup', 'mesh', 'components']),
  metadatagroup: new Set(['metadata']),
  mesh: new Set(['vertices', 'triangles']),
  vertices: new Set(['vertex']),
  vertex: new Set(),
  triangles: new Set(['triangle']),
  triangle: new Set(),
  components: new Set(['component']),
  component: new Set(),
  build: new Set(['item']),
  item: new Set(['metadatagroup']),
}

export const THREE_MF_UPLOAD_LIMITS = {
  archiveBytes: MAX_ARCHIVE_BYTES,
  uncompressedBytes: MAX_UNCOMPRESSED_BYTES,
  modelBytes: MAX_MODEL_BYTES,
  entries: MAX_ARCHIVE_ENTRIES,
  triangles: MAX_TRIANGLES,
} as const

type XmlNode = Record<string, unknown>
type Transform = readonly [number, number, number, number, number, number, number, number, number, number, number, number]
export type ThreeMfObjectType = 'model' | 'solidsupport' | 'support' | 'surface' | 'other'
export type ThreeMfParseOptions = {
  includeObjectTypes?: readonly ThreeMfObjectType[]
  rejectObjectTypes?: readonly ThreeMfObjectType[]
  rejectMaterialAssignments?: boolean
}

export const SUPPORTED_THREE_MF_PARSE_OPTIONS = {
  includeObjectTypes: ['model'],
  rejectObjectTypes: ['solidsupport', 'support', 'surface'],
  rejectMaterialAssignments: true,
} as const satisfies ThreeMfParseOptions

const identityTransform: Transform = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]
const unitScaleMm: Record<string, number> = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1000,
}

export function parseThreeMf(file: Uint8Array, options: ThreeMfParseOptions = {}): Float32Array {
  if (file.byteLength > MAX_ARCHIVE_BYTES) throw new Error(`3MF archive exceeds the ${formatMiB(MAX_ARCHIVE_BYTES)} limit`)
  const archive = readArchiveIndex(file)
  const relationships = parseXml(
    archive.relationships,
    '3MF package relationships',
    { nodes: MAX_RELATIONSHIP_XML_NODES, attributes: MAX_RELATIONSHIP_XML_ATTRIBUTES },
    { root: 'Relationships', namespace: RELATIONSHIPS_NAMESPACE, encoding: 'opc' },
  )
  const relationshipIds = new Set<string>()
  const relationshipList = arrayOf(node(relationships.Relationships, 'Relationships').Relationship)
  const relationshipTargets: string[] = []
  for (const relationship of relationshipList) {
    const id = stringAttribute(relationship, 'Id')
    if (!XML_ID.test(id)) throw new Error(`invalid OPC Relationship Id: ${id}`)
    if (relationshipIds.has(id)) throw new Error(`duplicate OPC Relationship Id: ${id}`)
    relationshipIds.add(id)
    stringAttribute(relationship, 'Type')
    const targetMode = stringAttribute(relationship, 'TargetMode', 'Internal')
    if (targetMode !== 'Internal') throw new Error(`unsupported OPC Relationship TargetMode: ${targetMode}`)
    relationshipTargets.push(safeArchiveTarget(stringAttribute(relationship, 'Target')))
  }
  for (const target of relationshipTargets)
    if (!archive.entries.has(target.toLowerCase())) throw new Error(`OPC relationship target is missing: ${target}`)
  const startParts = relationshipList.filter((relationship) => stringAttribute(relationship, 'Type') === START_PART_RELATIONSHIP)
  if (!startParts.length) throw new Error('3MF package does not define a StartPart relationship')
  if (startParts.length > 1) throw new Error('3MF package defines multiple StartPart relationships')
  const startPart = startParts[0]
  const modelPath = safeArchiveTarget(stringAttribute(startPart, 'Target'))
  const modelEntry = archive.entries.get(modelPath.toLowerCase())
  if (!modelEntry) throw new Error(`3MF model part is missing: ${modelPath}`)
  validatePackageContentTypes(archive.contentTypes, modelPath)
  if (modelEntry.size > MAX_MODEL_BYTES) throw new Error(`${modelEntry.name} exceeds the allowed 3MF model-part size`)
  const modelBytes = extractArchiveEntry(file, modelEntry)
  return parseModel(modelBytes, options)
}

function readArchiveIndex(file: Uint8Array) {
  let entryCount = 0
  let uncompressedBytes = 0
  const seen = new Set<string>()
  const entries = new Map<string, { name: string; size: number }>()
  let extracted: Record<string, Uint8Array>
  try {
    extracted = unzipSync(file, {
      filter: (entry) => {
        const canonicalName = validateArchiveEntry(entry, seen)
        entryCount++
        uncompressedBytes += entry.originalSize
        if (entryCount > MAX_ARCHIVE_ENTRIES) throw new Error(`3MF archive contains more than ${MAX_ARCHIVE_ENTRIES} entries`)
        if (uncompressedBytes > MAX_UNCOMPRESSED_BYTES)
          throw new Error(`3MF archive expands beyond the ${formatMiB(MAX_UNCOMPRESSED_BYTES)} limit`)
        const lowerName = canonicalName.toLowerCase()
        entries.set(lowerName, { name: entry.name, size: entry.originalSize })
        if (lowerName === '_rels/.rels' && entry.originalSize > MAX_RELATIONSHIPS_BYTES)
          throw new Error(`${entry.name} exceeds the allowed 3MF relationships size`)
        if (lowerName === '[content_types].xml' && entry.originalSize > MAX_CONTENT_TYPES_BYTES)
          throw new Error(`${entry.name} exceeds the allowed OPC content-types size`)
        return lowerName === '_rels/.rels' || lowerName === '[content_types].xml'
      },
    })
  } catch (error) {
    throw new Error(`invalid 3MF archive: ${errorMessage(error)}`, { cause: error })
  }
  const relationships = Object.entries(extracted).find(([name]) => name.toLowerCase() === '_rels/.rels')?.[1]
  if (!relationships) throw new Error('3MF package relationships are missing')
  const contentTypes = Object.entries(extracted).find(([name]) => name.toLowerCase() === '[content_types].xml')?.[1]
  if (!contentTypes) throw new Error('3MF package [Content_Types].xml is missing')
  return { entries, relationships, contentTypes }
}

function extractArchiveEntry(file: Uint8Array, selected: { name: string; size: number }) {
  try {
    const extracted = unzipSync(file, { filter: (entry) => entry.name.toLowerCase() === selected.name.toLowerCase() })
    const bytes = Object.entries(extracted).find(([name]) => name.toLowerCase() === selected.name.toLowerCase())?.[1]
    if (!bytes) throw new Error(`archive entry is missing: ${selected.name}`)
    if (bytes.byteLength !== selected.size) throw new Error(`archive entry size changed while extracting: ${selected.name}`)
    return bytes
  } catch (error) {
    throw new Error(`invalid 3MF archive: ${errorMessage(error)}`, { cause: error })
  }
}

function validateArchiveEntry(entry: UnzipFileInfo, seen: Set<string>) {
  if (entry.compression !== 0 && entry.compression !== 8) throw new Error(`unsupported ZIP compression in ${entry.name}`)
  if (!entry.name || entry.name.includes('\\') || entry.name.includes('\0') || entry.name.startsWith('/'))
    throw new Error(`unsafe archive path: ${entry.name || '(empty)'}`)
  const segments = entry.name.split('/')
  if (segments.some((segment) => segment === '..') || /^[a-z]:/i.test(entry.name)) throw new Error(`unsafe archive path: ${entry.name}`)
  const canonicalName = canonicalPartName(entry.name, `archive path: ${entry.name}`)
  const key = canonicalName.toLowerCase()
  if (seen.has(key)) throw new Error(`duplicate archive entry: ${entry.name}`)
  seen.add(key)
  return canonicalName
}

function safeArchiveTarget(target: string) {
  if (
    !target ||
    target.includes('\\') ||
    target.includes('?') ||
    target.includes('#') ||
    target.startsWith('//') ||
    /^[a-z][a-z\d+.-]*:/i.test(target)
  )
    throw new Error(`unsafe 3MF model target: ${target}`)
  const segments = target.replace(/^\/+/, '').split('/')
  const normalizedSegments: string[] = []
  for (const segment of segments) {
    if (!segment) throw new Error(`unsafe 3MF model target: ${target}`)
    const canonical = canonicalPartSegment(segment, `3MF model target: ${target}`)
    normalizedSegments.push(canonical)
  }
  const normalized = normalizedSegments.join('/')
  if (!normalized) throw new Error(`unsafe 3MF model target: ${target}`)
  return normalized
}

function safeAbsolutePartName(partName: string) {
  if (!partName.startsWith('/') || partName.startsWith('//'))
    throw new Error(`OPC Override PartName must be an absolute part name: ${partName}`)
  return safeArchiveTarget(partName)
}

function canonicalPartName(name: string, label: string) {
  if (name === '[Content_Types].xml') return name
  return name
    .split('/')
    .map((segment) => canonicalPartSegment(segment, label))
    .join('/')
}

function canonicalPartSegment(segment: string, label: string) {
  if (!/^(?:[A-Za-z0-9._~!$&'()*+,;=:@-]|%[\da-f]{2})+$/.test(segment)) throw new Error(`invalid ${label}`)
  let decoded: string
  try {
    decoded = decodeURIComponent(segment)
  } catch {
    throw new Error(`invalid ${label}`)
  }
  if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\') || decoded.includes('\0'))
    throw new Error(`unsafe ${label}`)
  return segment.replace(/%[\da-f]{2}/gi, (escape) => escape.toUpperCase())
}

function validatePackageContentTypes(bytes: Uint8Array, modelPath: string) {
  const document = parseXml(
    bytes,
    'OPC content types',
    { nodes: MAX_RELATIONSHIP_XML_NODES, attributes: MAX_RELATIONSHIP_XML_ATTRIBUTES },
    { root: 'Types', namespace: CONTENT_TYPES_NAMESPACE, encoding: 'opc' },
  )
  const types = node(document.Types, 'Types')
  const defaults = new Map<string, string>()
  for (const entry of arrayOf(types.Default)) {
    const extension = stringAttribute(entry, 'Extension')
    if (!/^[^.\s/\\]+$/.test(extension)) throw new Error(`invalid OPC Default Extension: ${extension}`)
    const key = extension.toLowerCase()
    if (defaults.has(key)) throw new Error(`duplicate OPC Default mapping: ${extension}`)
    defaults.set(key, stringAttribute(entry, 'ContentType'))
  }
  const overrides = new Map<string, string>()
  for (const entry of arrayOf(types.Override)) {
    const partName = stringAttribute(entry, 'PartName')
    const key = canonicalPartKey(safeAbsolutePartName(partName))
    if (overrides.has(key)) throw new Error(`duplicate OPC Override mapping: ${partName}`)
    overrides.set(key, stringAttribute(entry, 'ContentType'))
  }
  const modelKey = canonicalPartKey(modelPath)
  const extension = modelPath.split('/').at(-1)?.split('.').at(-1)?.toLowerCase()
  const contentType = overrides.get(modelKey) ?? (extension ? defaults.get(extension) : undefined)
  if (contentType?.toLowerCase() !== MODEL_CONTENT_TYPE)
    throw new Error(`3MF model part has an invalid or missing content type: ${modelPath}`)
  const relationshipsContentType = overrides.get(canonicalPartKey('_rels/.rels')) ?? defaults.get('rels')
  if (relationshipsContentType?.toLowerCase() !== RELATIONSHIPS_CONTENT_TYPE)
    throw new Error('3MF root relationships part has an invalid or missing content type')
}

function parseModel(bytes: Uint8Array, options: ThreeMfParseOptions) {
  const document = parseXml(
    bytes,
    '3MF model',
    { nodes: MAX_MODEL_XML_NODES, attributes: MAX_MODEL_XML_ATTRIBUTES },
    { root: 'model', namespace: CORE_NAMESPACE, encoding: 'utf8' },
  )
  const model = node(document.model, 'model')
  const requiredExtensions = optionalStringAttribute(model, 'requiredextensions')
  if (requiredExtensions) throw new Error(`3MF model requires unsupported extensions: ${requiredExtensions}`)
  const scale = unitScaleMm[stringAttribute(model, 'unit', 'millimeter').toLowerCase()]
  if (!scale) throw new Error(`unsupported 3MF unit: ${String(model.unit)}`)
  const resources = node(model.resources, 'model resources')
  const objects = new Map<number, XmlNode>()
  const resourceIds = new Set<number>()
  for (const resourceName of ['basematerials', 'object'] as const) {
    for (const resource of arrayOf(resources[resourceName])) {
      const id = resourceIdAttribute(resource, 'id')
      if (resourceIds.has(id)) throw new Error(`duplicate 3MF resource id: ${id}`)
      resourceIds.add(id)
      if (resourceName === 'object') objects.set(id, resource)
      else validateBaseMaterials(resource)
    }
  }
  if (!objects.size) throw new Error('3MF model contains no objects')
  const buildItems = arrayOf(node(model.build, 'model build').item)
  if (!buildItems.length) throw new Error('3MF model contains no build items')
  const output: number[] = []
  for (const item of buildItems) {
    rejectExternalObjectReference(item)
    appendObject(resourceIdAttribute(item, 'objectid'), parseTransform(item.transform), objects, new Set(), output, options)
    if (output.length / 9 > MAX_TRIANGLES) throw new Error(`3MF model exceeds the ${MAX_TRIANGLES.toLocaleString()} triangle limit`)
  }
  if (!output.length) throw new Error('3MF model contains no triangles')
  const positions = new Float32Array(output.length)
  for (let index = 0; index < output.length; index++) {
    const scaled = output[index] * scale
    if (!Number.isFinite(scaled) || Math.abs(scaled) > MAX_FLOAT32)
      throw new Error('3MF coordinates exceed Float32 range after unit scaling')
    positions[index] = scaled
  }
  return positions
}

function validateBaseMaterials(resource: XmlNode) {
  const bases = arrayOf(resource.base)
  if (!bases.length) throw new Error('3MF basematerials must contain at least one base')
  for (const base of bases) {
    stringAttribute(base, 'name')
    const displayColor = stringAttribute(base, 'displaycolor')
    if (!THREE_MF_COLOR.test(displayColor)) throw new Error('invalid 3MF displaycolor')
  }
}

function canonicalPartKey(name: string) {
  return name.toLowerCase()
}

function rejectCoreMaterialAssignments(object: XmlNode, mesh: XmlNode | undefined) {
  if (hasAnyAttribute(object, ['pid', 'pindex'])) throw new Error('3MF core material assignments are not supported for plate export')
  if (!mesh) return
  for (const triangle of arrayOf(optionalNode(mesh.triangles)?.triangle)) {
    if (hasAnyAttribute(triangle, ['pid', 'pindex', 'p1', 'p2', 'p3']))
      throw new Error('3MF core material assignments are not supported for plate export')
  }
}

function hasAnyAttribute(element: XmlNode, names: readonly string[]) {
  return names.some((name) => Object.hasOwn(element, name))
}

function appendObject(
  id: number,
  transform: Transform,
  objects: Map<number, XmlNode>,
  parents: Set<number>,
  output: number[],
  options: ThreeMfParseOptions,
) {
  if (parents.has(id)) throw new Error(`cyclic 3MF component reference: ${id}`)
  const object = objects.get(id)
  if (!object) throw new Error(`3MF object does not exist: ${id}`)
  const mesh = optionalNode(object.mesh)
  const components = optionalNode(object.components)
  if (!!mesh === !!components) throw new Error(`3MF object ${id} must contain either a mesh or components`)
  if (options.rejectMaterialAssignments) rejectCoreMaterialAssignments(object, mesh)
  if (mesh) {
    const objectType = parseObjectType(object, id)
    if (objectType === 'other') throw new Error(`3MF build references object ${id} of type other`)
    if (options.rejectObjectTypes?.includes(objectType))
      throw new Error(`3MF object type ${objectType} is not supported for this operation`)
    if (options.includeObjectTypes && !options.includeObjectTypes.includes(objectType)) return
    appendMesh(mesh, transform, output)
    return
  }
  const nextParents = new Set(parents).add(id)
  const componentList = arrayOf(components!.component)
  if (!componentList.length) throw new Error(`3MF component object ${id} is empty`)
  for (const component of componentList) {
    rejectExternalObjectReference(component)
    appendObject(
      resourceIdAttribute(component, 'objectid'),
      multiplyTransforms(transform, parseTransform(component.transform)),
      objects,
      nextParents,
      output,
      options,
    )
  }
}

function parseObjectType(object: XmlNode, id: number): ThreeMfObjectType {
  const objectType = optionalStringAttribute(object, 'type') ?? 'model'
  if (!['model', 'solidsupport', 'support', 'surface', 'other'].includes(objectType))
    throw new Error(`3MF object ${id} uses invalid core object type: ${objectType}`)
  return objectType as ThreeMfObjectType
}

function rejectExternalObjectReference(element: XmlNode) {
  const pathAttribute = Object.keys(element).find((name) => name === 'path' || name.endsWith(':path'))
  if (pathAttribute) throw new Error('3MF Production Extension cross-model references are not supported')
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
      const transformed = transformPoint(transform, point)
      if (transformed.some((value) => !Number.isFinite(value))) throw new Error('3MF transform produces invalid coordinates')
      output.push(...transformed)
      if (output.length / 9 > MAX_TRIANGLES) throw new Error(`3MF model exceeds the ${MAX_TRIANGLES.toLocaleString()} triangle limit`)
    }
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
  const values = tokens.map(Number)
  if (values.some((item) => !Number.isFinite(item))) throw new Error(`invalid 3MF transform: ${value}`)
  return values as unknown as Transform
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

function parseXml(
  bytes: Uint8Array | undefined,
  label: string,
  limits: { nodes: number; attributes: number },
  expected: { root: string; namespace: string; encoding: 'opc' | 'utf8' },
): XmlNode {
  if (!bytes) throw new Error(`${label} is missing`)
  const xml = decodeXml(bytes, label, expected.encoding)
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error(`${label} contains unsupported declarations`)
  const validation = XMLValidator.validate(xml)
  if (validation !== true) throw new Error(`invalid ${label} XML: ${validation.err.msg}`)
  let nodes = 0
  let attributes = 0
  const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    removeNSPrefix: false,
    parseTagValue: false,
    parseAttributeValue: false,
    alwaysCreateTextNode: true,
    processEntities: false,
    attributeValueProcessor: (_name, value) => decodeXmlAttributeReferences(value),
    maxNestedTags: MAX_XML_DEPTH,
    isArray: (name) =>
      ['Relationship', 'Default', 'Override', 'object', 'vertex', 'triangle', 'component', 'item'].includes(localName(name)),
    updateTag: (name, _tagPath, values) => {
      nodes++
      const count = Object.keys(values).length
      attributes += count
      if (nodes > limits.nodes) throw new Error(`${label} exceeds the ${limits.nodes.toLocaleString()} element limit`)
      if (count > MAX_ATTRIBUTES_PER_ELEMENT) throw new Error(`${label} contains an element with too many attributes`)
      if (attributes > limits.attributes) throw new Error(`${label} exceeds the ${limits.attributes.toLocaleString()} attribute limit`)
      return name
    },
  })
  try {
    return normalizeXmlDocument(node(xmlParser.parse(xml), label), label, expected)
  } catch (error) {
    throw new Error(`invalid ${label} XML: ${errorMessage(error)}`, { cause: error })
  }
}

function validateCoreElement(parentName: string, elementName: string) {
  if (!CORE_ELEMENT_CHILDREN[elementName]) throw new Error(`unsupported Core element: ${elementName}`)
  if (!CORE_ELEMENT_CHILDREN[parentName]?.has(elementName))
    throw new Error(`Core element ${elementName} is not allowed inside ${parentName}`)
}

function decodeXml(bytes: Uint8Array, label: string, profile: 'opc' | 'utf8') {
  const detected = detectXmlEncoding(bytes)
  if (profile === 'utf8' && detected.encoding !== 'utf-8') throw new Error(`${label} XML must be encoded as UTF-8`)
  let xml: string
  try {
    xml = new TextDecoder(detected.encoding, { fatal: true }).decode(bytes.subarray(detected.bomBytes))
  } catch (error) {
    throw new Error(`invalid ${label} ${detected.encoding.toUpperCase()} encoding`, { cause: error })
  }
  const declaration = /^<\?xml\s+[^>]*\bencoding\s*=\s*(['"])([^'"]+)\1[^>]*\?>/i.exec(xml)?.[2]
  if (profile === 'utf8' && declaration && normalizedXmlEncoding(declaration) !== 'utf-8') {
    throw new Error(`${label} XML declaration must name UTF-8`)
  }
  if (profile === 'opc' && declaration && !['utf-8', 'utf-16'].includes(normalizedXmlEncoding(declaration))) {
    throw new Error(`${label} XML declaration uses unsupported encoding ${declaration}`)
  }
  if (declaration && !xmlEncodingMatches(declaration, detected.encoding)) {
    throw new Error(`${label} XML declaration encoding ${declaration} does not match ${detected.encoding.toUpperCase()} bytes`)
  }
  return xml
}

function detectXmlEncoding(bytes: Uint8Array): { encoding: 'utf-8' | 'utf-16le' | 'utf-16be'; bomBytes: number } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { encoding: 'utf-8', bomBytes: 3 }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { encoding: 'utf-16le', bomBytes: 2 }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { encoding: 'utf-16be', bomBytes: 2 }
  if (bytes[0] === 0x3c && bytes[1] === 0x00 && bytes[2] === 0x3f && bytes[3] === 0x00) return { encoding: 'utf-16le', bomBytes: 0 }
  if (bytes[0] === 0x00 && bytes[1] === 0x3c && bytes[2] === 0x00 && bytes[3] === 0x3f) return { encoding: 'utf-16be', bomBytes: 0 }
  return { encoding: 'utf-8', bomBytes: 0 }
}

function xmlEncodingMatches(declaration: string, encoding: 'utf-8' | 'utf-16le' | 'utf-16be') {
  const normalized = normalizedXmlEncoding(declaration)
  return encoding === 'utf-8' ? normalized === 'utf-8' : normalized === 'utf-16'
}

function normalizedXmlEncoding(declaration: string) {
  return declaration.toLowerCase().replace(/[_\s]/g, '-')
}

function decodeXmlAttributeReferences(value: string) {
  return value.replace(/&([^;]+);/g, (reference, entity: string) => {
    const predefined = PREDEFINED_XML_ENTITIES[entity]
    if (predefined !== undefined) return predefined

    const decimal = /^#(\d+)$/.exec(entity)
    const hexadecimal = /^#x([\da-fA-F]+)$/.exec(entity)
    const codePoint = decimal ? Number(decimal[1]) : hexadecimal ? Number.parseInt(hexadecimal[1], 16) : undefined
    if (codePoint === undefined) throw new Error(`unsupported XML entity reference: ${reference}`)
    if (!isValidXmlCharacter(codePoint)) throw new Error(`invalid XML character reference: ${reference}`)
    return String.fromCodePoint(codePoint)
  })
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

function normalizeXmlDocument(document: XmlNode, label: string, expected: { root: string; namespace: string }) {
  const rootEntry = Object.entries(document).find(
    ([name, value]) => localName(name) === expected.root && value && typeof value === 'object',
  )
  if (!rootEntry) throw new Error(`${label} does not contain a ${expected.root} root element`)
  const [rootName, rootValue] = rootEntry
  const root = node(rootValue, expected.root)
  const namespaces = new Map<string, string>()
  namespaces.set('xml', XML_NAMESPACE)
  applyNamespaceDeclarations(root, namespaces)
  if (namespaces.get(namespacePrefix(rootName)) !== expected.namespace)
    throw new Error(`${label} uses an unsupported ${expected.root} namespace`)
  return { [expected.root]: normalizeXmlNode(root, namespaces, expected.namespace, expected.root, label) }
}

function normalizeXmlNode(
  nodeValue: XmlNode,
  namespaces: Map<string, string>,
  coreNamespace: string,
  elementName: string,
  label: string,
): XmlNode {
  const scopedNamespaces = new Map(namespaces)
  applyNamespaceDeclarations(nodeValue, scopedNamespaces)
  const normalized: XmlNode = {}
  for (const [name, value] of Object.entries(nodeValue)) {
    if (name === 'xmlns' || name.startsWith('xmlns:')) continue
    const elementValue = value && typeof value === 'object'
    if (!elementValue && name !== '#text' && coreNamespace === CORE_NAMESPACE) validateCoreAttribute(elementName, name, scopedNamespaces)
    const normalizedName = elementValue ? localName(name) : name
    const normalizedValue = Array.isArray(value)
      ? value.flatMap((item) => {
          const child = normalizeXmlElement(name, node(item, label), scopedNamespaces, coreNamespace, elementName, label)
          return child ? [child] : []
        })
      : elementValue
        ? normalizeXmlElement(name, node(value, label), scopedNamespaces, coreNamespace, elementName, label)
        : value
    if (normalizedValue === undefined || (Array.isArray(normalizedValue) && !normalizedValue.length)) continue
    if (normalized[normalizedName] !== undefined)
      throw new Error(`${label} contains duplicate namespace-equivalent elements: ${normalizedName}`)
    normalized[normalizedName] = normalizedValue
  }
  if (coreNamespace === CORE_NAMESPACE) validateCoreElementValue(elementName, normalized, scopedNamespaces)
  return normalized
}

function validateCoreElementValue(elementName: string, element: XmlNode, namespaces: Map<string, string>) {
  if (elementName === 'metadata') {
    const name = stringAttribute(element, 'name')
    if (!XML_QNAME.test(name)) throw new Error(`invalid 3MF metadata QName: ${name}`)
    const prefix = namespacePrefix(name)
    if (prefix && !namespaces.has(prefix)) throw new Error(`3MF metadata QName uses an undeclared prefix: ${prefix}`)
    const preserve = optionalStringAttribute(element, 'preserve')
    if (preserve !== undefined && !XML_BOOLEAN.test(preserve)) throw new Error(`invalid 3MF metadata preserve boolean: ${preserve}`)
  }
  if (elementName === 'metadatagroup' && !arrayOf(element.metadata).length)
    throw new Error('3MF metadatagroup must contain at least one metadata element')
  if (elementName === 'model' || elementName === 'metadatagroup') validateUniqueMetadataNames(elementName, element)
}

function validateUniqueMetadataNames(elementName: string, element: XmlNode) {
  const names = new Set<string>()
  for (const metadata of arrayOf(element.metadata)) {
    const name = stringAttribute(metadata, 'name')
    if (names.has(name)) throw new Error(`duplicate 3MF metadata name in ${elementName}: ${name}`)
    names.add(name)
  }
}

function normalizeXmlElement(
  name: string,
  value: XmlNode,
  namespaces: Map<string, string>,
  coreNamespace: string,
  parentName: string,
  label: string,
) {
  const childNamespaces = new Map(namespaces)
  applyNamespaceDeclarations(value, childNamespaces)
  if (childNamespaces.get(namespacePrefix(name)) !== coreNamespace) return undefined
  const childName = localName(name)
  if (coreNamespace === CORE_NAMESPACE) validateCoreElement(parentName, childName)
  return normalizeXmlNode(value, childNamespaces, coreNamespace, childName, label)
}

function applyNamespaceDeclarations(nodeValue: XmlNode, namespaces: Map<string, string>) {
  for (const [name, value] of Object.entries(nodeValue)) {
    if (name === 'xmlns' && typeof value === 'string') namespaces.set('', value)
    else if (name.startsWith('xmlns:') && typeof value === 'string') namespaces.set(name.slice(6), value)
  }
}

function validateCoreAttribute(elementName: string, attributeName: string, namespaces: Map<string, string>) {
  const allowed = CORE_ELEMENT_ATTRIBUTES[elementName]
  if (!allowed) return
  const prefix = namespacePrefix(attributeName)
  if (!prefix) {
    if (!allowed.has(attributeName)) throw new Error(`3MF ${elementName} contains unsupported Core attribute: ${attributeName}`)
    return
  }
  const namespace = namespaces.get(prefix)
  if (!namespace || namespace === CORE_NAMESPACE)
    throw new Error(`3MF ${elementName} contains unsupported Core attribute: ${attributeName}`)
  if (namespace === XML_NAMESPACE) {
    if (elementName === 'model' && attributeName === 'xml:lang') return
    throw new Error(`3MF ${elementName} contains unsupported XML attribute: ${attributeName}`)
  }
  if (prefix === 'xsi' || namespace === XML_SCHEMA_INSTANCE_NAMESPACE)
    throw new Error(`3MF ${elementName} contains unsupported XML Schema instance attribute: ${attributeName}`)
}

function namespacePrefix(name: string) {
  const separator = name.indexOf(':')
  return separator === -1 ? '' : name.slice(0, separator)
}

function localName(name: string) {
  const separator = name.indexOf(':')
  return separator === -1 ? name : name.slice(separator + 1)
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
  const value = element[name]
  if (value === undefined && fallback !== undefined) return fallback
  if (typeof value !== 'string' || !value.trim()) throw new Error(`missing 3MF attribute: ${name}`)
  return value.trim()
}

function optionalStringAttribute(element: XmlNode, name: string) {
  const value = element[name]
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
  const value = decimalIntegerAttribute(element, name, 'resource id')
  if (value === 0) throw new Error(`invalid 3MF resource id: ${name}`)
  return value
}

function resourceIndexAttribute(element: XmlNode, name: string) {
  return decimalIntegerAttribute(element, name, 'index')
}

function decimalIntegerAttribute(element: XmlNode, name: string, label: string) {
  const lexicalValue = stringAttribute(element, name)
  if (!THREE_MF_INTEGER.test(lexicalValue)) throw new Error(`invalid 3MF ${label}: ${name}`)
  const value = Number(lexicalValue)
  if (!Number.isInteger(value) || value >= MAX_RESOURCE_INTEGER) throw new Error(`invalid 3MF ${label}: ${name}`)
  return value
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function formatMiB(bytes: number) {
  return `${bytes / 1024 / 1024} MiB`
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
