import { afterEach, describe, expect, it, vi } from 'vitest'
import { hostedDeployment } from './hosted'

describe('hostedDeployment', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('uses the STL Quest environment variable', () => {
    vi.stubEnv('STLQUEST_HOSTED', 'true')

    expect(hostedDeployment()).toBe(true)
  })

  it('accepts the legacy environment variable', () => {
    vi.stubEnv('PRINTHUB_HOSTED', 'true')

    expect(hostedDeployment()).toBe(true)
  })

  it('lets the STL Quest variable override the legacy variable', () => {
    vi.stubEnv('STLQUEST_HOSTED', 'false')
    vi.stubEnv('PRINTHUB_HOSTED', 'true')

    expect(hostedDeployment()).toBe(false)
  })
})
