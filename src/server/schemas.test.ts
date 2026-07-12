import { describe, expect, it } from 'vitest'
import { acceptInviteSchema, createInviteSchema, requestFiltersSchema, storageSettingsSchema, updateRequestSchema } from './schemas'

describe('server input schemas', () => {
  it('normalizes invite identity fields', () => {
    expect(createInviteSchema.parse({ role: 'requester', email: ' PERSON@EXAMPLE.COM ' })).toEqual({
      role: 'requester',
      email: 'person@example.com',
    })
    expect(
      acceptInviteSchema.parse({
        token: 'invite-token',
        name: '  Ada  ',
        email: 'ADA@EXAMPLE.COM',
        password: 'password1234',
      }),
    ).toEqual({
      token: 'invite-token',
      name: 'Ada',
      email: 'ada@example.com',
      password: 'password1234',
    })
    expect(() =>
      acceptInviteSchema.parse({ token: 'invite-token', name: 'Ada', email: 'ada@example.com', password: 'short-pass' }),
    ).toThrow()
  })

  it('validates and normalizes storage settings', () => {
    expect(storageSettingsSchema.parse({ adapter: 'local', root: '  /prints  ' })).toEqual({ adapter: 'local', root: '/prints' })
    expect(() => storageSettingsSchema.parse({ adapter: 'local', root: 'relative' })).toThrow()
    expect(() =>
      storageSettingsSchema.parse({
        adapter: 's3',
        endpoint: 'file:///tmp',
        region: 'us-east-1',
        bucket: 'models',
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        forcePathStyle: false,
      }),
    ).toThrow()
  })

  it('rejects malformed request updates', () => {
    expect(() => updateRequestSchema.parse({ id: 'request', quantity: 0 })).toThrow()
    expect(() => updateRequestSchema.parse({ id: 'request', sourceUrl: 'javascript:alert(1)' })).toThrow()
    expect(updateRequestSchema.parse({ id: 'request', sourceUrl: '' })).toEqual({ id: 'request', sourceUrl: '' })
  })

  it('validates board filters and cross-field ranges', () => {
    expect(requestFiltersSchema.parse({ query: '  orange gear  ', minQuantity: 2, sort: 'name-asc' })).toEqual({
      query: 'orange gear',
      minQuantity: 2,
      sort: 'name-asc',
    })
    expect(() => requestFiltersSchema.parse({ minQuantity: 5, maxQuantity: 2 })).toThrow()
    expect(() => requestFiltersSchema.parse({ createdAfter: 20, createdBefore: 10 })).toThrow()
  })
})
