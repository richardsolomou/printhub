import { useEffect, useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { CircleAlert } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { PASSWORD_MIN_LENGTH } from '../core/security'
import { acceptInvite, beginProviderInvite, inviteInfo } from '../server/fns'
import { AuthBrand } from '../client/components/Brand'
import { AuthMethodIcon } from '../client/components/AuthMethodIcon'
import { authClient } from '../client/authClient'
import type { SocialAuthProvider } from '../core/auth'

export const Route = createFileRoute('/invite/$token')({
  loader: ({ params }) => inviteInfo({ data: { token: params.token } }),
  component: InvitePage,
})

function InvitePage() {
  const { valid, auth } = Route.useLoaderData()
  const { token } = Route.useParams()
  const callAccept = useServerFn(acceptInvite)
  const callBeginProvider = useServerFn(beginProviderInvite)
  const [error, setError] = useState('')
  const [hydrated, setHydrated] = useState(false)
  const [providerBusy, setProviderBusy] = useState<SocialAuthProvider | null>(null)
  useEffect(() => setHydrated(true), [])
  const continueWithProvider = async (provider: SocialAuthProvider) => {
    setError('')
    setProviderBusy(provider)
    try {
      await callBeginProvider({ data: { token, provider } })
      const { error: failed } = await authClient.signIn.social({
        provider,
        callbackURL: '/',
        errorCallbackURL: `/invite/${token}`,
        requestSignUp: true,
      })
      if (failed) setError(`Could not continue with ${provider === 'google' ? 'Google' : 'Discord'}.`)
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not continue with this provider.')
    } finally {
      setProviderBusy(null)
    }
  }
  const form = useForm({
    defaultValues: { name: '', email: '', password: '' },
    onSubmit: async ({ value }) => {
      setError('')
      try {
        await callAccept({ data: { token, ...value } })
        window.location.href = '/'
      } catch (err) {
        setError(err instanceof Error && err.message ? err.message : 'Could not create your account.')
      }
    },
  })

  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="flex w-full max-w-[440px] flex-col gap-8">
        <AuthBrand />
        {valid ? (
          <Card className="w-full shadow-xl shadow-black/10">
            <CardHeader>
              <CardTitle>You're invited</CardTitle>
              <CardDescription>Create your account to start requesting prints. This link works once.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {auth.socialProviders.length > 0 && (
                <div className="flex flex-col gap-2">
                  {auth.socialProviders.map((provider) => (
                    <Button
                      key={provider}
                      type="button"
                      variant="outline"
                      disabled={providerBusy !== null}
                      onClick={() => void continueWithProvider(provider)}
                    >
                      {providerBusy === provider && <Spinner />}
                      {!providerBusy && <AuthMethodIcon method={provider} />}
                      Continue with {provider === 'google' ? 'Google' : 'Discord'}
                    </Button>
                  ))}
                  {auth.password && (
                    <div className="relative my-1 text-center text-xs text-muted-foreground before:absolute before:top-1/2 before:left-0 before:w-full before:border-t">
                      <span className="relative bg-card px-2">or create a password</span>
                    </div>
                  )}
                </div>
              )}
              {auth.password && (
                <form
                  data-hydrated={hydrated}
                  className="flex flex-col gap-4"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void form.handleSubmit()
                  }}
                >
                  <form.Field name="name" validators={{ onChange: ({ value }) => (value.trim() ? undefined : 'Name is required') }}>
                    {(field) => (
                      <Field>
                        <FieldLabel htmlFor="invite-name">Name</FieldLabel>
                        <Input
                          id="invite-name"
                          value={field.state.value}
                          onChange={(event) => field.handleChange(event.target.value)}
                          maxLength={100}
                          required
                        />
                      </Field>
                    )}
                  </form.Field>
                  <form.Field
                    name="email"
                    validators={{ onChange: ({ value }) => (/^\S+@\S+\.\S+$/.test(value) ? undefined : 'Use a valid email') }}
                  >
                    {(field) => (
                      <Field>
                        <FieldLabel htmlFor="invite-email">Email</FieldLabel>
                        <Input
                          id="invite-email"
                          type="email"
                          value={field.state.value}
                          onChange={(event) => field.handleChange(event.target.value)}
                          required
                          autoComplete="email"
                        />
                      </Field>
                    )}
                  </form.Field>
                  <form.Field
                    name="password"
                    validators={{
                      onChange: ({ value }) =>
                        value.length >= PASSWORD_MIN_LENGTH ? undefined : `Use at least ${PASSWORD_MIN_LENGTH} characters`,
                    }}
                  >
                    {(field) => (
                      <Field>
                        <FieldLabel htmlFor="invite-password">Password</FieldLabel>
                        <Input
                          id="invite-password"
                          type="password"
                          value={field.state.value}
                          onChange={(event) => field.handleChange(event.target.value)}
                          minLength={PASSWORD_MIN_LENGTH}
                          maxLength={256}
                          required
                          autoComplete="new-password"
                        />
                      </Field>
                    )}
                  </form.Field>
                  {error && (
                    <Alert variant="destructive">
                      <CircleAlert />
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}
                  <form.Subscribe selector={(state) => state.isSubmitting}>
                    {(busy) => (
                      <Button type="submit" disabled={busy}>
                        {busy && <Spinner />}
                        {busy ? 'Creating…' : 'Create account'}
                      </Button>
                    )}
                  </form.Subscribe>
                </form>
              )}
              {!auth.password && error && (
                <Alert variant="destructive">
                  <CircleAlert />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card className="w-full shadow-xl shadow-black/10">
            <CardHeader>
              <CardTitle>Invite not valid</CardTitle>
              <CardDescription>
                This invite link has been used, revoked, or has expired. Ask the person who runs this PrintHub for a new one.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>
    </main>
  )
}
