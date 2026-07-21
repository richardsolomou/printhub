import { describe, expect, it } from 'vitest'
import { buildEmailDelivery, resolveSmtpConfig } from './email'

describe('SMTP configuration', () => {
  it('is optional', () => {
    expect(resolveSmtpConfig(undefined, {})).toBeUndefined()
    expect(buildEmailDelivery()).toBeUndefined()
  })

  it('validates environment configuration', () => {
    expect(() => resolveSmtpConfig(undefined, { SMTP_HOST: 'smtp.example.com' })).toThrow(/EMAIL_FROM/)
  })

  it('reads stored SMTP settings', () => {
    const smtp = { from: 'print@example.com', host: 'smtp.example.com', port: 587, secure: false, testedAt: 123 }
    expect(resolveSmtpConfig({ passwordEnabled: true, smtp }, {})).toEqual(smtp)
  })
})
