import { useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { changePassword } from '../server/fns'

export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const callChangePassword = useServerFn(changePassword)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await callChangePassword({ data: { currentPassword, newPassword } })
      onClose()
    } catch {
      setError('Could not change your password. Check your current password and use at least 12 characters.')
      setBusy(false)
    }
  }

  return <div className="overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
    <form className="dialog dialog-small" onSubmit={submit}>
      <h2>Change password</h2>
      <div className="field"><label htmlFor="current-password">Current password</label><input id="current-password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} maxLength={256} autoComplete="current-password" required /></div>
      <div className="field"><label htmlFor="new-password">New password</label><input id="new-password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={12} maxLength={256} autoComplete="new-password" required /></div>
      {error && <p className="error">{error}</p>}
      <div className="dialog-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Changing…' : 'Change password'}</button></div>
    </form>
  </div>
}
