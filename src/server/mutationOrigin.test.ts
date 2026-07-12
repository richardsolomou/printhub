import { describe, expect, it } from 'vitest'
import { requireMutationOrigin } from './mutationOrigin'

describe('cookie-auth mutation origin guard', () => {
  it('accepts same-origin mutations', () => {
    expect(() => requireMutationOrigin(new Request('https://print.test/_server', {
      headers: { origin: 'https://print.test', 'sec-fetch-site': 'same-origin' },
    }))).not.toThrow()
  })

  it('rejects same-site sibling and missing-origin mutations', () => {
    expect(() => requireMutationOrigin(new Request('https://print.test/_server', {
      headers: { origin: 'https://sibling.test', 'sec-fetch-site': 'same-site' },
    }))).toThrow(expect.objectContaining({ status: 403 }))
    expect(() => requireMutationOrigin(new Request('https://print.test/_server'))).toThrow(expect.objectContaining({ status: 403 }))
  })
})
