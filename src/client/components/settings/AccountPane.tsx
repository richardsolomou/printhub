import { useState, type ReactNode } from 'react'
import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { PASSWORD_MIN_LENGTH } from '../../../core/security'
import type { SocialAuthProvider } from '../../../core/auth'
import type { Identity } from '../../../core/types'
import { setOwnPassword } from '../../../server/fns'
import { authClient } from '../../authClient'
import { accountMethodsQuery, sessionQuery } from '../../queries'
import { AuthMethodIcon } from '../AuthMethodIcon'
import { DialogShell } from '../DialogShell'
import { UserAvatar } from '../UserAvatar'
import { SettingsActions, SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'

const PROVIDER_NAMES: Record<SocialAuthProvider, string> = { google: 'Google', discord: 'Discord' }

export function AccountPane({ me }: { me: Identity }) {
  const queryClient = useQueryClient()
  const { data: session } = useQuery(sessionQuery())
  const { data: methods } = useQuery(accountMethodsQuery())
  const navigate = useNavigate()
  const linked = new Set(methods?.linked ?? [])
  const hasPassword = linked.has('credential')
  const methodsLoaded = methods !== undefined
  const [changingPassword, setChangingPassword] = useState(false)
  return (
    <SettingsPage>
      <SettingsHeader title="Account" description="Manage your profile and sign-in methods." />
      <SettingsSection>
        <div className="flex items-center gap-3">
          <UserAvatar name={me.name} image={me.image} size="lg" />
          <div>
            <h3 className="font-medium">{me.name}</h3>
            <p className="text-sm text-muted-foreground">{me.email}</p>
          </div>
        </div>
      </SettingsSection>
      <SettingsSection title="Sign-in methods" description="Link multiple methods so you always have another way into your account.">
        <div className="grid gap-3 sm:grid-cols-3">
          <MethodCard
            method="password"
            name="Password"
            linked={hasPassword}
            available={methods?.passwordAvailable ?? false}
            loaded={methodsLoaded}
            action={
              hasPassword && session?.auth.password ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setChangingPassword(true)}>
                  Change password
                </Button>
              ) : methods?.passwordAvailable ? (
                <CreatePasswordForm
                  onDone={async () => {
                    await queryClient.invalidateQueries({ queryKey: ['account-methods'] })
                  }}
                />
              ) : undefined
            }
          />
          {(methods?.availableProviders ?? []).map((provider) => (
            <MethodCard
              key={provider}
              method={provider}
              name={PROVIDER_NAMES[provider]}
              linked={linked.has(provider)}
              available
              loaded={methodsLoaded}
              action={
                !linked.has(provider) ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void authClient.linkSocial({ provider, callbackURL: '/settings/account', errorCallbackURL: '/settings/account' })
                    }
                  >
                    <AuthMethodIcon method={provider} /> Link {PROVIDER_NAMES[provider]}
                  </Button>
                ) : undefined
              }
            />
          ))}
        </div>
      </SettingsSection>
      {changingPassword && (
        <DialogShell title="Change password" onClose={() => setChangingPassword(false)}>
          <ChangePasswordForm onDone={() => setChangingPassword(false)} />
        </DialogShell>
      )}
      <SettingsActions>
        <Button
          type="button"
          variant="outline"
          className="sign-out"
          onClick={async () => {
            await authClient.signOut()
            await queryClient.invalidateQueries({ queryKey: ['session'] })
            await navigate({ to: '/' })
          }}
        >
          Sign out
        </Button>
      </SettingsActions>
    </SettingsPage>
  )
}

function MethodCard({
  method,
  name,
  linked,
  available,
  loaded,
  action,
}: {
  method: 'password' | SocialAuthProvider
  name: string
  linked: boolean
  available: boolean
  loaded: boolean
  action?: ReactNode
}) {
  return (
    <Card data-auth-method={method}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AuthMethodIcon method={method} /> {name}
        </CardTitle>
        <CardDescription>
          {!loaded ? 'Checking account…' : linked ? 'Linked to this account.' : available ? 'Available to link.' : 'Disabled by the admin.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-3">
        <Badge variant={linked ? 'default' : 'secondary'}>
          {!loaded ? 'Checking' : linked ? 'Linked' : available ? 'Not linked' : 'Unavailable'}
        </Badge>
        {action}
      </CardContent>
    </Card>
  )
}

function CreatePasswordForm({ onDone }: { onDone: () => void | Promise<void> }) {
  const callSetPassword = useServerFn(setOwnPassword)
  const [password, setPassword] = useState('')
  const mutation = useMutation({
    mutationFn: callSetPassword,
    onSuccess: async () => {
      setPassword('')
      await onDone()
      toast.success('Password sign-in enabled.')
    },
  })
  return (
    <div className="flex w-full flex-col gap-2">
      <Input
        type="password"
        value={password}
        minLength={PASSWORD_MIN_LENGTH}
        maxLength={256}
        autoComplete="new-password"
        placeholder="Create a password"
        onChange={(event) => setPassword(event.target.value)}
      />
      <Button
        type="button"
        size="sm"
        disabled={password.length < PASSWORD_MIN_LENGTH || mutation.isPending}
        onClick={() => mutation.mutate({ data: { password } })}
      >
        {mutation.isPending && <Spinner />}
        {mutation.isPending ? 'Creating…' : 'Create password'}
      </Button>
      <FieldError>{mutation.error?.message}</FieldError>
    </div>
  )
}

function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const [error, setError] = useState('')
  const form = useForm({
    defaultValues: { currentPassword: '', newPassword: '' },
    onSubmit: async ({ value }) => {
      setError('')
      const { error: failed } = await authClient.changePassword({ ...value, revokeOtherSessions: true })
      if (failed)
        setError(`Could not change your password. Check your current password and use at least ${PASSWORD_MIN_LENGTH} characters.`)
      else {
        form.reset()
        toast.success('Password changed.')
        onDone()
      }
    },
  })
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
      className="flex max-w-md flex-col gap-3"
    >
      <FieldDescription>Change the password used with {`your account email`}.</FieldDescription>
      <form.Field name="currentPassword">
        {(field) => (
          <Field>
            <FieldLabel htmlFor="current-password">Current password</FieldLabel>
            <Input
              id="current-password"
              type="password"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              maxLength={256}
              autoComplete="current-password"
              required
            />
          </Field>
        )}
      </form.Field>
      <form.Field
        name="newPassword"
        validators={{
          onChange: ({ value }) => (value.length >= PASSWORD_MIN_LENGTH ? undefined : `Use at least ${PASSWORD_MIN_LENGTH} characters`),
        }}
      >
        {(field) => (
          <Field>
            <FieldLabel htmlFor="new-password">New password</FieldLabel>
            <Input
              id="new-password"
              type="password"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              minLength={PASSWORD_MIN_LENGTH}
              maxLength={256}
              autoComplete="new-password"
              required
            />
          </Field>
        )}
      </form.Field>
      <FieldError>{error}</FieldError>
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(busy) => (
          <Button type="submit" disabled={busy}>
            {busy && <Spinner />}
            {busy ? 'Changing…' : 'Change password'}
          </Button>
        )}
      </form.Subscribe>
    </form>
  )
}
