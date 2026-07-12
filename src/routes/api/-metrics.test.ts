import { describe, expect, it } from 'vitest'
import { validToken } from './metrics'

describe('metrics authentication', () => {
  it('accepts only an exact bearer token', () => {
    expect(validToken('Bearer monitor-secret', 'monitor-secret')).toBe(true)
    expect(validToken('Bearer monitor-secrex', 'monitor-secret')).toBe(false)
    expect(validToken('Bearer short', 'monitor-secret')).toBe(false)
    expect(validToken(null, 'monitor-secret')).toBe(false)
  })
})
