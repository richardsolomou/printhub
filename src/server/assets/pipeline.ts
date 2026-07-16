import { MeshoptSimplifier } from 'meshoptimizer'
import { exportBinaryStl, parseStl } from '../../core/mesh/stl'
import { parseThreeMf } from '../../core/mesh/threeMf'
import type { ModelFormat } from '../../core/modelFormat'
import { analyzePositions, type MeshAnalysis } from '../../core/mesh/meshAnalysis'
import { rasterize } from '../../core/mesh/rasterize'
import {
  measureOrientationBounds,
  rankResinOrientations,
  type OrientationBounds,
  type QuaternionTuple,
  type ResinOrientation,
} from '../../core/mesh/resinOrientation'
import { encodePng } from './png'

const THUMB_SIZE = 256
const PREVIEW_MIN_BYTES = 12 * 1024 * 1024
const PREVIEW_MIN_TRIANGLES = 400_000
const PREVIEW_TARGET_TRIANGLES = 100_000
// A preview earns its keep by being meaningfully smaller than the original.
const PREVIEW_MAX_BYTES = 8 * 1024 * 1024
const PREVIEW_MAX_FRACTION = 0.45
const PREVIEW_MAX_ERROR = 0.02

export type GeneratedAssets = {
  thumbnailPng?: Uint8Array
  previewStl?: Uint8Array
  orientationCandidates?: ResinOrientation[]
  orientationBounds?: OrientationBounds[]
  meshAnalysis?: MeshAnalysis
}

export type AssetWants = {
  thumbnail: boolean
  preview: boolean
  orientation?: boolean
  orientationQuaternions?: QuaternionTuple[]
  meshAnalysis?: boolean
}

export async function generateVisualAssets(
  file: Uint8Array,
  format: ModelFormat,
  wants: { thumbnail: boolean; preview: boolean },
  thumbnailReady?: (thumbnail: Uint8Array) => void | Promise<void>,
): Promise<{ previewStl?: Uint8Array }> {
  const positions = parseModel(file, format)
  if (wants.thumbnail) {
    const thumbnail = encodePng(rasterize(positions, THUMB_SIZE), THUMB_SIZE, THUMB_SIZE)
    await thumbnailReady?.(thumbnail)
  }
  return { previewStl: wants.preview ? await buildPreview(positions, file.byteLength, format === '3mf') : undefined }
}

/** Parse the model once and derive the requested card thumbnail and lightweight STL preview. */
export async function generateAssets(file: Uint8Array, format: ModelFormat, wants: AssetWants): Promise<GeneratedAssets> {
  const positions = parseModel(file, format)
  const thumbnailPng = wants.thumbnail ? encodePng(rasterize(positions, THUMB_SIZE), THUMB_SIZE, THUMB_SIZE) : undefined
  const previewStl = wants.preview ? await buildPreview(positions, file.byteLength, format === '3mf') : undefined
  const orientationCandidates = wants.orientation ? rankResinOrientations(positions) : undefined
  const orientationBounds = wants.orientationQuaternions?.map((quaternion) => measureOrientationBounds(positions, quaternion))
  const meshAnalysis = wants.meshAnalysis ? analyzePositions(positions) : undefined
  return { thumbnailPng, previewStl, orientationCandidates, orientationBounds, meshAnalysis }
}

export async function buildPreview(positions: Float32Array, originalBytes: number, required: boolean): Promise<Uint8Array | undefined> {
  const triangleCount = positions.length / 9
  if (!required && originalBytes <= PREVIEW_MIN_BYTES && triangleCount <= PREVIEW_MIN_TRIANGLES) return undefined
  if (required && triangleCount <= PREVIEW_TARGET_TRIANGLES) return exportBinaryStl(positions, sequentialIndices(positions.length / 3))

  const byteCap = required ? PREVIEW_MAX_BYTES : Math.min(PREVIEW_MAX_BYTES, originalBytes * PREVIEW_MAX_FRACTION)
  const indices = sequentialIndices(positions.length / 3)
  const targetTriangles = Math.min(PREVIEW_TARGET_TRIANGLES, Math.floor((byteCap - 84) / 50))
  await MeshoptSimplifier.ready
  const [previewIndices] = MeshoptSimplifier.simplifySloppy(indices, positions, 3, null, targetTriangles * 3, PREVIEW_MAX_ERROR)
  if (!previewIndices.length || (previewIndices.length / 3) * 50 + 84 > byteCap) {
    if (required) throw new Error('model could not be simplified into a complete preview within the size limit')
    return undefined
  }
  return exportBinaryStl(positions, previewIndices)
}

function parseModel(file: Uint8Array, format: ModelFormat) {
  return format === '3mf' ? parseThreeMf(file) : parseStl(file)
}

function sequentialIndices(length: number) {
  const indices = new Uint32Array(length)
  for (let index = 0; index < indices.length; index++) indices[index] = index
  return indices
}
