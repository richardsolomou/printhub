import { wrap } from 'comlink'
import { isPhone } from './device'
import type { RowThumbWorker } from './rowThumb.worker'

// Instant feedback while composing an upload, using the same software
// rasterizer the server runs. Deliberately bounded: desktop only, files small
// enough to parse without jank; anything bigger keeps the placeholder and
// gets its real thumbnail from the server after upload.
const MAX_BYTES = 25 * 1024 * 1024
const SIZE = 128
let worker: Worker | undefined

function renderer() {
  worker ??= new Worker(new URL('./rowThumb.worker.ts', import.meta.url), { type: 'module' })
  return wrap<RowThumbWorker>(worker)
}

export async function renderRowThumbnail(file: File): Promise<string | undefined> {
  if (isPhone() || file.size > MAX_BYTES) return undefined
  try {
    const rgba = await renderer().render(await file.arrayBuffer(), SIZE)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = SIZE
    const context = canvas.getContext('2d')
    if (!context) return undefined
    context.putImageData(new ImageData(new Uint8ClampedArray(rgba), SIZE, SIZE), 0, 0)
    return canvas.toDataURL('image/png')
  } catch {
    return undefined
  }
}
