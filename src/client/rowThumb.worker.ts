import { expose, transfer } from 'comlink'
import { parseStl } from '../core/mesh/stl'
import { parseThreeMf } from '../core/mesh/threeMf'
import { rasterize } from '../core/mesh/rasterize'
import type { ModelFormat } from '../core/modelFormat'

const api = {
  render(buffer: ArrayBuffer, size: number, format: ModelFormat) {
    const bytes = new Uint8Array(buffer)
    const rgba = rasterize(format === '3mf' ? parseThreeMf(bytes) : parseStl(bytes), size)
    return transfer(rgba, [rgba.buffer])
  },
}

export type RowThumbWorker = typeof api
expose(api)
