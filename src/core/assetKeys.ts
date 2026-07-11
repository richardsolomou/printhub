import crypto from 'node:crypto'
import { initialStatus, statusById } from './workflow'

// Keys are storage-agnostic, '/'-separated paths shared by every AssetStore.
const baseName = (key: string) => key.split('/').pop() ?? key

export function createAssetKey(originalFileName: string) {
  const base = baseName(originalFileName).replace(/\.stl$/i, '').replace(/[^\w.\- ]+/g, '_').trim().slice(0, 120) || 'model'
  return `${initialStatus().folder}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}__${base}.stl`
}

export function previewKey(originalKey: string) {
  return `.printhub/previews/${baseName(originalKey)}`
}

export function destinationKey(key: string, statusId: string) {
  return `${statusById(statusId).folder}/${baseName(key)}`
}

export function trashKey(operationId: string, key: string) {
  if (!/^[a-f0-9-]{36}$/i.test(operationId)) throw new Error('invalid operation id')
  const assetId = crypto.createHash('sha256').update(key).digest('hex').slice(0, 16)
  return `.printhub/trash/${operationId}__${assetId}__${baseName(key)}`
}
