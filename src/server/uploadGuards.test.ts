import { describe, expect, it } from 'vitest'
import { UploadRequestLimiter, validSameOrigin } from './uploadGuards'

describe('upload guards', () => {
  it('requires the browser request to come from the same origin', () => {
    expect(
      validSameOrigin(
        new Request('https://print.test/api/upload', { headers: { origin: 'https://print.test', 'sec-fetch-site': 'same-origin' } }),
      ),
    ).toBe(true)
    expect(
      validSameOrigin(
        new Request('https://print.test/api/upload', { headers: { origin: 'https://evil.test', 'sec-fetch-site': 'cross-site' } }),
      ),
    ).toBe(false)
  })

  it('bounds concurrent upload requests globally and per identity', () => {
    const limiter = new UploadRequestLimiter(2, 1)
    const first = limiter.enter('owner-a')
    expect(first).toBeTypeOf('function')
    expect(limiter.enter('owner-a')).toBeUndefined()
    const second = limiter.enter('owner-b')
    expect(second).toBeTypeOf('function')
    expect(limiter.enter('owner-c')).toBeUndefined()
    first!()
    expect(limiter.enter('owner-c')).toBeTypeOf('function')
    second!()
  })
})
