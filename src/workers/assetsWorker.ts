/// <reference lib="webworker" />
import { generateAssets } from '../lib/assetPipeline'

// One file at a time: parsing several 200 MB meshes concurrently would blow
// the worker's memory, and sequential work is what keeps the queue smooth.
let chain = Promise.resolve()

self.onmessage = (event: MessageEvent<{ id: number; buffer: ArrayBuffer }>) => {
  const { id, buffer } = event.data
  chain = chain.then(async () => {
    const { thumbnailBlob, previewBytes } = await generateAssets(buffer, new OffscreenCanvas(256, 256))
    self.postMessage({ id, thumbnailBlob, previewBytes }, previewBytes ? { transfer: [previewBytes] } : {})
  })
}
