import { describe, expect, it, vi } from 'vitest'
import { createModelGeometryWorker } from './modelGeometryClient'

describe('createModelGeometryWorker', () => {
  it('terminates the viewer-owned worker during cleanup', () => {
    const terminate = vi.fn()
    const worker = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      postMessage: vi.fn(),
      terminate,
    } as unknown as Worker

    const client = createModelGeometryWorker(() => worker)
    client.terminate()

    expect(terminate).toHaveBeenCalledOnce()
  })
})
