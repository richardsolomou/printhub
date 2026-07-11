import { generateAssets, type GeneratedAssets } from './assetPipeline'

export type UploadAssets = { thumbnail?: string; preview?: File }

type WorkerReply = { id: number } & GeneratedAssets

let worker: Worker | undefined
let nextId = 0
const pending = new Map<number, (reply: WorkerReply) => void>()

const workerSupported = () => typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined'

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/assetsWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      pending.get(event.data.id)?.(event.data)
      pending.delete(event.data.id)
    }
  }
  return worker
}

async function generate(buffer: ArrayBuffer): Promise<GeneratedAssets> {
  if (workerSupported()) {
    return new Promise((resolve) => {
      const id = nextId++
      pending.set(id, resolve)
      getWorker().postMessage({ id, buffer }, [buffer])
    })
  }
  return generateAssets(buffer, document.createElement('canvas'))
}

const blobToDataURL = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })

/** Heavy mesh work (parse, thumbnail, decimation) runs in a worker, one file at a time. */
export async function prepareUploadAssets(file: File): Promise<UploadAssets> {
  try {
    const { thumbnailBlob, previewBytes } = await generate(await file.arrayBuffer())
    return {
      thumbnail: thumbnailBlob ? await blobToDataURL(thumbnailBlob) : undefined,
      preview: previewBytes
        ? new File([previewBytes], file.name.replace(/\.stl$/i, '.preview.stl'))
        : undefined,
    }
  } catch {
    return {}
  }
}
