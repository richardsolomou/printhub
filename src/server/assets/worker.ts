import { parentPort, workerData } from 'node:worker_threads'
import { generateAssets, generateVisualAssets, type AssetWants, type GeneratedAssets } from './pipeline'
import { parseThreeMf } from '../../core/mesh/threeMf'
import type { ModelFormat } from '../../core/modelFormat'

// worker_threads entry, bundled separately by `pnpm build` into
// .output/server/assets-worker.mjs. One job per worker: the buffer arrives
// transferred, results transfer back, and the process isolation means a
// pathological mesh cannot stall or crash request handling.
const data = workerData as {
  file: Uint8Array
  format: ModelFormat
  wants?: AssetWants
  mode?: 'combined' | 'visual' | 'validate'
}
const { file, format, mode = 'combined' } = data
const wants = data.wants ?? { thumbnail: false, preview: false }

const work: Promise<GeneratedAssets> =
  mode === 'validate'
    ? Promise.resolve().then(() => {
        parseThreeMf(file)
        return {}
      })
    : mode === 'visual'
      ? generateVisualAssets(file, format, wants, (thumbnailPng) => {
          const transfers = thumbnailPng.buffer instanceof ArrayBuffer ? [thumbnailPng.buffer] : []
          parentPort!.postMessage({ ok: true as const, stage: 'thumbnail' as const, thumbnailPng }, transfers)
        })
      : generateAssets(file, format, wants)

work.then(
  (generated) => {
    const thumbnailPng = generated.thumbnailPng
    const transfers = [thumbnailPng?.buffer, generated.previewStl?.buffer].filter(
      (buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer,
    )
    parentPort!.postMessage({ ok: true as const, stage: 'complete' as const, ...generated }, transfers)
  },
  (error: unknown) => {
    parentPort!.postMessage({ ok: false as const, message: error instanceof Error ? error.message : String(error) })
  },
)
