import { expose, transfer } from 'comlink'
import { parseStl } from '../core/mesh/stl'
import { rasterize } from '../core/mesh/rasterize'

const api = {
  render(buffer: ArrayBuffer, size: number) {
    const rgba = rasterize(parseStl(new Uint8Array(buffer)), size)
    return transfer(rgba, [rgba.buffer])
  },
}

export type RowThumbWorker = typeof api
expose(api)
