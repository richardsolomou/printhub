import type { Telemetry } from '../core/types'
import { TELEMETRY_HOST, TELEMETRY_TOKEN } from '../core/telemetry'

export class OptionalPostHogTelemetry implements Telemetry {
  // enabled is a thunk so flipping the setting applies without a restart.
  constructor(private enabled: () => boolean) {}

  async capture(identity: string, event: string, properties?: Record<string, unknown>) {
    try {
      if (!this.enabled()) return
      const { PostHog } = await import('posthog-node')
      const client = new PostHog(TELEMETRY_TOKEN, { host: TELEMETRY_HOST, flushAt: 1, flushInterval: 0 })
      client.capture({ distinctId: identity, event, properties })
      await client.shutdown()
    } catch {}
  }

  async exception(error: unknown, properties?: Record<string, unknown>) {
    await this.capture('server', '$exception', { ...properties, error: error instanceof Error ? error.message : String(error) })
  }
}
