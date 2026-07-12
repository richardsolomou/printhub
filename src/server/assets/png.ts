import { encode } from 'fast-png'

export function encodePng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  return encode({ width, height, data: rgba, channels: 4, depth: 8 }, { zlib: { level: 9 } })
}
