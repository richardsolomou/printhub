import { parseThreeMf } from '../core/mesh/threeMf'

export type PreparedModelGeometry = {
  positions: Float32Array
  normals: Float32Array
}

export function persistedModelGeometryState(
  format: 'stl' | '3mf',
  hasPreview: boolean,
  fullRequested: boolean,
  previewStatus?: 'pending' | 'running' | 'ready' | 'skipped' | 'failed',
) {
  const preview = hasPreview && !fullRequested
  const previewFailed = format === '3mf' && !hasPreview && previewStatus === 'failed'
  return {
    source: { preview, format: preview ? ('stl' as const) : format },
    waitingForPreview: format === '3mf' && !hasPreview && !previewFailed,
    requiresFullDetailConfirmation: previewFailed && !fullRequested,
  }
}

export function prepareThreeMfGeometry(buffer: ArrayBuffer): PreparedModelGeometry {
  const positions = parseThreeMf(new Uint8Array(buffer))
  centerPositions(positions)
  return { positions, normals: triangleNormals(positions) }
}

function centerPositions(positions: Float32Array) {
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (let index = 0; index < positions.length; index += 3) {
    minX = Math.min(minX, positions[index])
    minY = Math.min(minY, positions[index + 1])
    minZ = Math.min(minZ, positions[index + 2])
    maxX = Math.max(maxX, positions[index])
    maxY = Math.max(maxY, positions[index + 1])
    maxZ = Math.max(maxZ, positions[index + 2])
  }
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  const centerZ = (minZ + maxZ) / 2
  for (let index = 0; index < positions.length; index += 3) {
    positions[index] -= centerX
    positions[index + 1] -= centerY
    positions[index + 2] -= centerZ
  }
}

function triangleNormals(positions: Float32Array) {
  const normals = new Float32Array(positions.length)
  for (let index = 0; index < positions.length; index += 9) {
    const abX = positions[index + 3] - positions[index]
    const abY = positions[index + 4] - positions[index + 1]
    const abZ = positions[index + 5] - positions[index + 2]
    const acX = positions[index + 6] - positions[index]
    const acY = positions[index + 7] - positions[index + 1]
    const acZ = positions[index + 8] - positions[index + 2]
    let normalX = abY * acZ - abZ * acY
    let normalY = abZ * acX - abX * acZ
    let normalZ = abX * acY - abY * acX
    const length = Math.hypot(normalX, normalY, normalZ)
    if (length) {
      normalX /= length
      normalY /= length
      normalZ /= length
    }
    for (let vertex = 0; vertex < 3; vertex++) {
      const offset = index + vertex * 3
      normals[offset] = normalX
      normals[offset + 1] = normalY
      normals[offset + 2] = normalZ
    }
  }
  return normals
}
