import { describe, expect, it } from 'vitest'
import { readRequestedFileAsset, requestedFileAsset } from './fileAsset'

describe('requestedFileAsset', () => {
  const request = { fileName: 'gear.3mf', filePath: 'todo/gear.3mf' }

  it('does not substitute the original model for a missing preview', () => {
    expect(requestedFileAsset(request, true)).toBeUndefined()
  })

  it('returns the generated STL only when it exists', () => {
    expect(requestedFileAsset({ ...request, previewPath: '.printhub/previews/gear.stl' }, true)).toEqual({
      path: '.printhub/previews/gear.stl',
      fileName: 'gear.stl',
    })
  })

  it('uses the original STL when preview generation was skipped', async () => {
    const original = { stream: new ReadableStream(), size: 42 }
    const stlRequest = { fileName: 'gear.stl', filePath: 'todo/gear.stl' }

    await expect(readRequestedFileAsset(stlRequest, true, async () => original)).resolves.toEqual({
      path: stlRequest.filePath,
      fileName: stlRequest.fileName,
      asset: original,
      previewFallback: false,
    })
  })

  it('falls back to the original 3MF when a recorded preview is stale', async () => {
    const original = { stream: new ReadableStream(), size: 42 }
    const read = async (path: string) => {
      if (path.endsWith('.stl')) throw new Error('missing preview')
      return original
    }

    await expect(readRequestedFileAsset({ ...request, previewPath: '.printhub/previews/gear.stl' }, true, read)).resolves.toEqual({
      path: 'todo/gear.3mf',
      fileName: 'gear.3mf',
      asset: original,
      previewFallback: true,
    })
  })
})
