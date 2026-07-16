export type ModelFormat = 'stl' | '3mf'

const STL_UPLOAD_BYTES = 1024 * 1024 * 1024
const THREE_MF_UPLOAD_BYTES = 128 * 1024 * 1024

export function modelFormat(fileName: string): ModelFormat | undefined {
  const extension = fileName.split('.').pop()?.toLowerCase()
  return extension === 'stl' || extension === '3mf' ? extension : undefined
}

export function requireModelFormat(fileName: string): ModelFormat {
  const format = modelFormat(fileName)
  if (!format) throw new Error('only .stl and .3mf files are accepted')
  return format
}

export function modelFormatLabel(format: ModelFormat): string {
  return format.toUpperCase()
}

export function modelUploadRejection(file: { name: string; size: number }): string | undefined {
  const format = modelFormat(file.name)
  if (!format) return `${file.name} (not an STL or 3MF)`
  if (file.size === 0) return `${file.name} (empty file)`
  const limit = format === '3mf' ? THREE_MF_UPLOAD_BYTES : STL_UPLOAD_BYTES
  if (file.size <= limit) return undefined
  return `${file.name} (over the ${format === '3mf' ? '128 MiB 3MF' : '1 GiB STL'} limit)`
}
