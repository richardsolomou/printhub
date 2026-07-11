import type { Telemetry, TelemetryConfig } from '../core/types'

export class OptionalPostHogTelemetry implements Telemetry {
  constructor(private config?: TelemetryConfig) {}

  async capture(identity: string, event: string, properties?: Record<string, unknown>) {
    try {
      if (!this.config?.token) return
      const { PostHog } = await import('posthog-node')
      const client = new PostHog(this.config.token, { host: this.config.host || undefined, flushAt: 1, flushInterval: 0 })
      client.capture({ distinctId: identity, event, properties })
      await client.shutdown()
    } catch {}
  }

  async exception(error: unknown, properties?: Record<string, unknown>) {
    await this.capture('server', '$exception', { ...properties, error: error instanceof Error ? error.message : String(error) })
  }
}
