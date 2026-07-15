import { describe, expect, it } from 'vitest'
import { cloudflareAccountId, inferS3Provider, s3Endpoint } from './storageProviders'

describe('storage provider presets', () => {
  it('builds provider endpoints from the guided fields', () => {
    expect(s3Endpoint('backblaze', 'us-west-004', '', '')).toBe('https://s3.us-west-004.backblazeb2.com')
    expect(s3Endpoint('cloudflare', 'auto', 'account-id', '')).toBe('https://account-id.r2.cloudflarestorage.com')
  })

  it('infers existing provider settings', () => {
    expect(inferS3Provider('https://s3.us-east-1.amazonaws.com')).toBe('aws')
    expect(cloudflareAccountId('https://abc123.r2.cloudflarestorage.com')).toBe('abc123')
  })
})
