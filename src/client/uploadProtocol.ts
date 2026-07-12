export function retryOffset(acceptedOffset: number, fileSize: number, chunkBytes: number) {
  if (!Number.isSafeInteger(acceptedOffset) || acceptedOffset < 0 || acceptedOffset > fileSize) throw new Error('server returned an invalid upload offset')
  return acceptedOffset === fileSize ? Math.max(0, fileSize - chunkBytes) : acceptedOffset
}
