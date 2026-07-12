import {
  SOCIAL_AUTH_PROVIDERS,
  type AuthAdapterConfig,
  type IntegrationConfig,
  type SocialAuthProvider,
  type SocialProviderConfig,
} from '../core/auth'

function enabled(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback
  return !['0', 'false', 'no', 'off'].includes(value.trim().toLowerCase())
}

function environmentProvider(provider: SocialAuthProvider, environment: NodeJS.ProcessEnv): SocialProviderConfig | undefined {
  const prefix = `AUTH_${provider.toUpperCase()}`
  const clientId = environment[`${prefix}_CLIENT_ID`]?.trim()
  const clientSecret = environment[`${prefix}_CLIENT_SECRET`]?.trim()
  if (!clientId && !clientSecret) return undefined
  if (!clientId || !clientSecret) throw new Error(`${prefix}_CLIENT_ID and ${prefix}_CLIENT_SECRET must be configured together`)
  return { enabled: enabled(environment[`${prefix}_ENABLED`], true), clientId, clientSecret }
}

export function resolveAuthAdapterConfig(stored?: IntegrationConfig, environment: NodeJS.ProcessEnv = process.env): AuthAdapterConfig {
  const providers = Object.fromEntries(
    SOCIAL_AUTH_PROVIDERS.map((provider) => [provider, environmentProvider(provider, environment) ?? stored?.[provider]]),
  ) as Partial<Record<SocialAuthProvider, SocialProviderConfig>>
  const recovery = enabled(environment.AUTH_PASSWORD_RECOVERY, false)
  const password = recovery || enabled(environment.AUTH_PASSWORD_ENABLED, stored?.passwordEnabled ?? true)
  const socialProviders = SOCIAL_AUTH_PROVIDERS.filter((provider) => providers[provider]?.enabled)
  if (!password && socialProviders.length === 0)
    throw new Error('password authentication cannot be disabled until at least one social provider is enabled')
  return { password, passwordReset: password, socialProviders, ...providers }
}
