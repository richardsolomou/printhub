import nodemailer from 'nodemailer'
import type { IntegrationConfig, SmtpEmailConfig } from '../core/auth'

export type EmailMessage = { to: string; subject: string; text: string; html?: string }

export interface EmailDelivery {
  send(message: EmailMessage): Promise<void>
  verify(): Promise<void>
}

class SmtpEmailDelivery implements EmailDelivery {
  private readonly transporter

  constructor(private readonly config: SmtpEmailConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user ? { user: config.user, pass: config.password } : undefined,
    })
  }

  async send(message: EmailMessage) {
    await this.transporter.sendMail({ from: this.config.from, ...message })
  }

  async verify() {
    await this.transporter.verify()
  }
}

function enabled(value: string | undefined) {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase())
}

function legacySmtp(stored?: IntegrationConfig): SmtpEmailConfig | undefined {
  if (stored?.smtp) return stored.smtp
  if (stored?.email?.adapter === 'smtp') {
    const email = stored.email as { from: string; host: string; port: number; secure: boolean; user?: string; password?: string }
    return { ...email, testedAt: stored.emailTestedAt }
  }
  const email = stored?.emails?.find((item) => item.adapter === 'smtp' && item.enabled) as
    | ({ from: string; host: string; port: number; secure: boolean; user?: string; password?: string; testedAt?: number } & Record<
        string,
        unknown
      >)
    | undefined
  return email
    ? {
        from: email.from,
        host: email.host,
        port: email.port,
        secure: email.secure,
        user: email.user,
        password: email.password,
        testedAt: email.testedAt,
      }
    : undefined
}

export function resolveSmtpConfig(stored?: IntegrationConfig, environment: NodeJS.ProcessEnv = process.env): SmtpEmailConfig | undefined {
  const configured = environment.SMTP_HOST?.trim()
  if (!configured) return legacySmtp(stored)
  const from = environment.EMAIL_FROM?.trim()
  const host = environment.SMTP_HOST?.trim()
  if (!from) throw new Error('EMAIL_FROM is required for SMTP email')
  if (!host) throw new Error('SMTP_HOST is required for SMTP email')
  const port = Number(environment.SMTP_PORT ?? 587)
  const user = environment.SMTP_USER?.trim()
  const password = environment.SMTP_PASSWORD
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('SMTP_PORT must be a valid TCP port')
  if ((user && !password) || (!user && password)) throw new Error('SMTP_USER and SMTP_PASSWORD must be configured together')
  return { from, host, port, secure: enabled(environment.SMTP_SECURE), user, password }
}

export function buildEmailDelivery(config?: SmtpEmailConfig): EmailDelivery | undefined {
  return config ? new SmtpEmailDelivery(config) : undefined
}
