import { describe, expect, it } from 'vitest'
import { resolveWorkerConfig } from './workerConfig'

describe('asset worker configuration', () => {
  it('fails closed when the production worker bundle is missing', () => {
    expect(() => resolveWorkerConfig({ vitest: false, dev: false, prod: true, candidates: [] })).toThrow(
      'assets worker is required in production',
    )
  })

  it('uses inline execution only when explicitly selected', () => {
    expect(resolveWorkerConfig({ vitest: true, dev: false, prod: false })).toEqual({ inline: true })
  })
})
