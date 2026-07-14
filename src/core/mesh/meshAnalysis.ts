import { parseStl } from './stl'

export type MeshAnalysis = {
  widthMm: number
  depthMm: number
  heightMm: number
  estimatedVolumeMm3?: number
  volumeReliable: boolean
}

export function analyzeMesh(file: Uint8Array): MeshAnalysis {
  return analyzePositions(parseStl(file))
}

export function analyzePositions(positions: Float32Array): MeshAnalysis {
  if (!positions.length || positions.length % 9 !== 0) throw new Error('STL contains no complete triangles')
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  let signedVolumeSix = 0
  const edges = new Map<string, number>()

  for (let index = 0; index < positions.length; index += 9) {
    const ax = positions[index]
    const ay = positions[index + 1]
    const az = positions[index + 2]
    const bx = positions[index + 3]
    const by = positions[index + 4]
    const bz = positions[index + 5]
    const cx = positions[index + 6]
    const cy = positions[index + 7]
    const cz = positions[index + 8]
    minX = Math.min(minX, ax, bx, cx)
    minY = Math.min(minY, ay, by, cy)
    minZ = Math.min(minZ, az, bz, cz)
    maxX = Math.max(maxX, ax, bx, cx)
    maxY = Math.max(maxY, ay, by, cy)
    maxZ = Math.max(maxZ, az, bz, cz)
    signedVolumeSix += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)
    addEdge(edges, ax, ay, az, bx, by, bz)
    addEdge(edges, bx, by, bz, cx, cy, cz)
    addEdge(edges, cx, cy, cz, ax, ay, az)
  }

  const volumeReliable = [...edges.values()].every((count) => count === 2) && Math.abs(signedVolumeSix) > Number.EPSILON
  return {
    widthMm: maxX - minX,
    depthMm: maxY - minY,
    heightMm: maxZ - minZ,
    estimatedVolumeMm3: volumeReliable ? Math.abs(signedVolumeSix) / 6 : undefined,
    volumeReliable,
  }
}

function addEdge(edges: Map<string, number>, ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
  const first = vertexKey(ax, ay, az)
  const second = vertexKey(bx, by, bz)
  const edge = first < second ? `${first}|${second}` : `${second}|${first}`
  edges.set(edge, (edges.get(edge) ?? 0) + 1)
}

function vertexKey(x: number, y: number, z: number) {
  return `${x.toPrecision(9)},${y.toPrecision(9)},${z.toPrecision(9)}`
}
