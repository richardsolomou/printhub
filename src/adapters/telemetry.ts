import type { Telemetry } from '../core/types'

export class OptionalPostHogTelemetry implements Telemetry {
  async capture(identity: string, event: string, properties?: Record<string, unknown>) {
    try {
      const key = process.env.POSTHOG_PROJECT_TOKEN
      if (!key) return
      const { PostHog } = await import('posthog-node')
      const client = new PostHog(key, { host: process.env.POSTHOG_HOST, flushAt: 1, flushInterval: 0 })
      client.capture({ distinctId: identity, event, properties })
      await client.shutdown()
    } catch {}
  }

  async exception(error: unknown, properties?: Record<string, unknown>) {
    await this.capture('server', '$exception', { ...properties, error: error instanceof Error ? error.message : String(error) })
  }
}
