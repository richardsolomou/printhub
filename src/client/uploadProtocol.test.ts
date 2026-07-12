import { describe, expect, it } from 'vitest'
import { retryOffset } from './uploadProtocol'

describe('upload retry protocol', () => {
  it('replays the final chunk when all bytes exist but finalization is incomplete', () => {
    expect(retryOffset(100, 100, 32)).toBe(68)
    expect(retryOffset(100, 100, 128)).toBe(0)
  })

  it('resumes an incomplete upload at the accepted offset', () => {
    expect(retryOffset(32, 100, 32)).toBe(32)
    expect(() => retryOffset(101, 100, 32)).toThrow('invalid upload offset')
  })
})
