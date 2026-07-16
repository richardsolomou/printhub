import type { PrintRequest } from '../core/types'

type ReadAsset = (path: string) => Promise<{ stream: ReadableStream; size: number }>

export function requestedFileAsset(request: Pick<PrintRequest, 'fileName' | 'filePath' | 'previewPath'>, preview: boolean) {
  if (!preview) return { path: request.filePath, fileName: request.fileName }
  if (!request.previewPath) {
    return request.filePath.toLowerCase().endsWith('.stl') ? { path: request.filePath, fileName: request.fileName } : undefined
  }
  return { path: request.previewPath, fileName: request.fileName.replace(/\.[^.]+$/, '.stl') }
}

export async function readRequestedFileAsset(
  request: Pick<PrintRequest, 'fileName' | 'filePath' | 'previewPath'>,
  preview: boolean,
  read: ReadAsset,
) {
  const requested = requestedFileAsset(request, preview)
  if (!requested) return undefined
  try {
    return { ...requested, asset: await read(requested.path), previewFallback: false }
  } catch (error) {
    if (!preview || !request.previewPath || !request.filePath.toLowerCase().endsWith('.3mf')) throw error
    return {
      path: request.filePath,
      fileName: request.fileName,
      asset: await read(request.filePath),
      previewFallback: true,
    }
  }
}
