import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import type { Identity } from '../core/types'
import { changePassword, createUser, logout } from '../server/fns'
import { usersQuery } from '../lib/queries'
import { useEscape } from '../lib/useEscape'

type Pane = 'account' | 'users' | 'storage' | 'about'

export function SettingsModal({ me, localAuth, onClose }: { me: Identity; localAuth: boolean; onClose: () => void }) {
  const [pane, setPane] = useState<Pane>('account')
  useEscape(onClose)
  const showUsers = localAuth && me.role === 'operator'
  const showStorage = me.role === 'operator'
  const panes: { id: Pane; label: string }[] = [
    { id: 'account', label: 'Account' },
    ...(showUsers ? [{ id: 'users' as const, label: 'Users' }] : []),
    ...(showStorage ? [{ id: 'storage' as const, label: 'Storage' }] : []),
    { id: 'about', label: 'About' },
  ]

  return (
    <div className="overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="dialog dialog-settings">
        <div className="settings-head">
          <h2>Settings</h2>
          <button type="button" className="btn settings-close" aria-label="Close settings" onClick={onClose}>✕</button>
        </div>
        <div className="settings-body">
          <nav className="settings-nav" aria-label="Settings sections">
            {panes.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`settings-nav-item${pane === item.id ? ' active' : ''}`}
                onClick={() => setPane(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div className="settings-pane">
            {pane === 'account' && <AccountPane me={me} localAuth={localAuth} />}
            {pane === 'users' && showUsers && <UsersPane />}
            {pane === 'storage' && showStorage && <StoragePane />}
            {pane === 'about' && <AboutPane localAuth={localAuth} />}
          </div>
        </div>
      </div>
    </div>
  )
}

function AccountPane({ me, localAuth }: { me: Identity; localAuth: boolean }) {
  const callLogout = useServerFn(logout)
  return (
    <>
      <h3>Account</h3>
      <p className="settings-identity">
        {me.name} <span className="settings-dim">({me.email})</span>
        <span className="chip settings-role">{me.role}</span>
      </p>
      {localAuth ? (
        <>
          <ChangePasswordForm />
          <div className="settings-actions">
            <button type="button" className="btn sign-out" onClick={async () => { await callLogout(); window.location.reload() }}>Sign out</button>
          </div>
        </>
      ) : (
        <p className="settings-dim">Your identity is managed by the authentication proxy in front of PrintHub.</p>
      )}
    </>
  )
}

function ChangePasswordForm() {
  const callChangePassword = useServerFn(changePassword)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      await callChangePassword({ data: { currentPassword, newPassword } })
      setCurrentPassword('')
      setNewPassword('')
      setSaved(true)
    } catch {
      setError('Could not change your password. Check your current password and use at least 8 characters.')
    }
    setBusy(false)
  }

  return (
    <form onSubmit={submit} className="settings-form">
      <div className="field"><label htmlFor="current-password">Current password</label><input id="current-password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} maxLength={256} autoComplete="current-password" required /></div>
      <div className="field"><label htmlFor="new-password">New password</label><input id="new-password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} maxLength={256} autoComplete="new-password" required /></div>
      {error && <p className="error">{error}</p>}
      {saved && <p className="settings-saved">Password changed.</p>}
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Changing…' : 'Change password'}</button>
    </form>
  )
}

function UsersPane() {
  const { data: users } = useQuery(usersQuery())
  const [adding, setAdding] = useState(false)
  return (
    <>
      <h3>Users</h3>
      <ul className="settings-users">
        {(users ?? []).map((user) => (
          <li key={user.id}>
            <span>{user.name}</span>
            <span className="settings-dim">{user.email}</span>
            <span className="chip settings-role">{user.role}</span>
          </li>
        ))}
      </ul>
      {adding ? <CreateUserForm onDone={() => setAdding(false)} /> : (
        <div className="settings-actions">
          <button type="button" className="btn" onClick={() => setAdding(true)}>Add user</button>
        </div>
      )}
    </>
  )
}

function CreateUserForm({ onDone }: { onDone: () => void }) {
  const callCreateUser = useServerFn(createUser)
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'requester' | 'operator'>('requester')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await callCreateUser({ data: { email, name, password, role } })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['people'] }),
        queryClient.invalidateQueries({ queryKey: ['users'] }),
      ])
      onDone()
    } catch {
      setError('Could not create this user. Check the fields and email address.')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="settings-form">
      <div className="field"><label htmlFor="user-name">Name</label><input id="user-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required /></div>
      <div className="field"><label htmlFor="user-email">Email</label><input id="user-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} required /></div>
      <div className="field"><label htmlFor="user-password">Initial password</label><input id="user-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={256} required /></div>
      <div className="field"><label htmlFor="user-role">Role</label><select id="user-role" value={role} onChange={(event) => setRole(event.target.value as typeof role)}><option value="requester">Requester</option><option value="operator">Operator</option></select></div>
      {error && <p className="error">{error}</p>}
      <div className="settings-actions"><button type="button" className="btn" onClick={onDone}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create user'}</button></div>
    </form>
  )
}

function StoragePane() {
  return (
    <>
      <h3>Storage</h3>
      <p className="settings-dim">Print files are stored on the local filesystem under the mounted prints folder.</p>
    </>
  )
}

function AboutPane({ localAuth }: { localAuth: boolean }) {
  return (
    <>
      <h3>About</h3>
      <p className="settings-dim">PrintHub v{__APP_VERSION__} · {localAuth ? 'built-in accounts' : 'trusted-header identity'}</p>
    </>
  )
}
