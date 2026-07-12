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

  it('migrates legacy SMTP settings and ignores other legacy providers', () => {
    const smtp = { adapter: 'smtp' as const, from: 'print@example.com', host: 'smtp.example.com', port: 587, secure: false }
    expect(resolveSmtpConfig({ passwordEnabled: true, email: smtp, emailTestedAt: 123 }, {})).toEqual({ ...smtp, testedAt: 123 })
    expect(resolveSmtpConfig({ passwordEnabled: true, email: { adapter: 'resend', apiKey: 'key' } }, {})).toBeUndefined()
  })
})
