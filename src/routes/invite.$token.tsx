import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { acceptInvite, inviteInfo } from '../server/fns'

export const Route = createFileRoute('/invite/$token')({
  loader: ({ params }) => inviteInfo({ data: { token: params.token } }),
  component: InvitePage,
})

function InvitePage() {
  const { valid } = Route.useLoaderData()
  const { token } = Route.useParams()
  const callAccept = useServerFn(acceptInvite)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await callAccept({ data: { token, name, email, password } })
      window.location.href = '/'
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not create your account.')
      setBusy(false)
    }
  }

  return (
    <main className="auth">
      <div className="auth-hero">
        <h1 className="logo">Print<span className="accent">Hub</span></h1>
        <p className="auth-tagline">self-hosted print queue</p>
        <div className="auth-dots" aria-hidden="true"><span /><span /><span /></div>
      </div>
      {valid ? (
        <form className="dialog auth-card" onSubmit={submit}>
          <h2>You're invited</h2>
          <p className="auth-intro">Create your account to start requesting prints. This link works once.</p>
          <div className="field"><label htmlFor="invite-name">Name</label><input id="invite-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required /></div>
          <div className="field"><label htmlFor="invite-email">Email</label><input id="invite-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" /></div>
          <div className="field"><label htmlFor="invite-password">Password</label><input id="invite-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={256} required autoComplete="new-password" /></div>
          {error && <p className="error">{error}</p>}
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
        </form>
      ) : (
        <div className="dialog auth-card">
          <h2>Invite not valid</h2>
          <p className="auth-intro">This invite link has been used, revoked, or has expired. Ask the person who runs this PrintHub for a new one.</p>
        </div>
      )}
    </main>
  )
}
