import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { createUser } from '../server/fns'

export function CreateUserDialog({ onClose }: { onClose: () => void }) {
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
      await queryClient.invalidateQueries({ queryKey: ['people'] })
      onClose()
    } catch {
      setError('Could not create this user. Check the fields and email address.')
      setBusy(false)
    }
  }

  return <div className="overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
    <form className="dialog dialog-small" onSubmit={submit}>
      <h2>Add user</h2>
      <div className="field"><label htmlFor="user-name">Name</label><input id="user-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required /></div>
      <div className="field"><label htmlFor="user-email">Email</label><input id="user-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} required /></div>
      <div className="field"><label htmlFor="user-password">Initial password</label><input id="user-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} maxLength={256} required /></div>
      <div className="field"><label htmlFor="user-role">Role</label><select id="user-role" value={role} onChange={(event) => setRole(event.target.value as typeof role)}><option value="requester">Requester</option><option value="operator">Operator</option></select></div>
      {error && <p className="error">{error}</p>}
      <div className="dialog-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create user'}</button></div>
    </form>
  </div>
}
