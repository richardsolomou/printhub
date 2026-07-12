import crypto from 'node:crypto'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteRepository } from '../adapters/sqlite'
import { INVITE_HEADER, createAuth } from './auth'

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef'
const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex')

function build() {
  const repository = new SqliteRepository(new Database(':memory:'))
  const auth = createAuth(repository.database, SECRET, {
    claimInvite: (token) => repository.claimInvite(hashToken(token), Date.now()),
  })
  return { repository, auth }
}

// Turns the set-cookie headers from one auth response into request headers
// for the next call, the way a browser would.
function cookieHeaders(headers: Headers) {
  const cookies = headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ')
  return new Headers({ cookie: cookies })
}

describe('better-auth integration', () => {
  let cleanup: (() => void) | undefined
  afterEach(() => cleanup?.())

  it('gives the first sign-up the operator role and closes sign-up afterwards', async () => {
    const { repository, auth } = build()
    cleanup = () => repository.close()

    const { headers } = await auth.api.signUpEmail({
      body: { email: 'first@example.com', password: 'password123', name: 'First' },
      returnHeaders: true,
    })
    const session = await auth.api.getSession({ headers: cookieHeaders(headers) })
    expect(session?.user).toMatchObject({ email: 'first@example.com', role: 'operator' })

    await expect(auth.api.signUpEmail({
      body: { email: 'second@example.com', password: 'password123', name: 'Second' },
    })).rejects.toMatchObject({ status: 'FORBIDDEN' })
    expect(repository.countUsers()).toBe(1)
  })

  it('lets operators create users with roles, but not requesters', async () => {
    const { repository, auth } = build()
    cleanup = () => repository.close()

    const { headers } = await auth.api.signUpEmail({
      body: { email: 'op@example.com', password: 'password123', name: 'Op' },
      returnHeaders: true,
    })
    const operator = cookieHeaders(headers)
    await auth.api.createUser({
      body: { email: 'maker@example.com', password: 'password123', name: 'Maker', role: 'requester' },
      headers: operator,
    })
    expect(repository.listUsers()).toMatchObject([
      { email: 'maker@example.com', role: 'requester' },
      { email: 'op@example.com', role: 'operator' },
    ])

    const { headers: makerHeaders } = await auth.api.signInEmail({
      body: { email: 'maker@example.com', password: 'password123' },
      returnHeaders: true,
    })
    await expect(auth.api.createUser({
      body: { email: 'sneak@example.com', password: 'password123', name: 'Sneak', role: 'operator' },
      headers: cookieHeaders(makerHeaders),
    })).rejects.toMatchObject({ status: 'FORBIDDEN' })
  })

  it('operator-set passwords plus session revocation lock out old sessions', async () => {
    const { repository, auth } = build()
    cleanup = () => repository.close()

    const { headers } = await auth.api.signUpEmail({
      body: { email: 'op@example.com', password: 'password123', name: 'Op' },
      returnHeaders: true,
    })
    const operator = cookieHeaders(headers)
    const created = await auth.api.createUser({
      body: { email: 'maker@example.com', password: 'first-password', name: 'Maker', role: 'requester' },
      headers: operator,
    })

    const { headers: makerHeaders } = await auth.api.signInEmail({
      body: { email: 'maker@example.com', password: 'first-password' },
      returnHeaders: true,
    })
    const makerSession = cookieHeaders(makerHeaders)
    expect(await auth.api.getSession({ headers: makerSession })).not.toBeNull()

    await auth.api.setUserPassword({ body: { userId: created.user.id, newPassword: 'second-password' }, headers: operator })
    await auth.api.revokeUserSessions({ body: { userId: created.user.id }, headers: operator })

    expect(await auth.api.getSession({ headers: makerSession })).toBeNull()
    await expect(auth.api.signInEmail({ body: { email: 'maker@example.com', password: 'first-password' } }))
      .rejects.toMatchObject({ status: 'UNAUTHORIZED' })
    await expect(auth.api.signInEmail({ body: { email: 'maker@example.com', password: 'second-password' } })).resolves.toBeTruthy()
  })

  it('admits exactly one sign-up per invite and honors expiry and revocation', async () => {
    const { repository, auth } = build()
    cleanup = () => repository.close()
    await auth.api.signUpEmail({ body: { email: 'op@example.com', password: 'password123', name: 'Op' } })

    repository.createInvite({ id: 'inv-1', tokenHash: hashToken('good-token'), role: 'requester', expiresAt: Date.now() + 60_000 })
    const withInvite = (token: string) => new Headers({ [INVITE_HEADER]: token })

    await expect(auth.api.signUpEmail({
      body: { email: 'stranger@example.com', password: 'password123', name: 'Stranger' },
      headers: withInvite('wrong-token'),
    })).rejects.toMatchObject({ status: 'FORBIDDEN' })

    const { headers } = await auth.api.signUpEmail({
      body: { email: 'customer@example.com', password: 'password123', name: 'Customer' },
      headers: withInvite('good-token'),
      returnHeaders: true,
    })
    const session = await auth.api.getSession({ headers: cookieHeaders(headers) })
    expect(session?.user).toMatchObject({ email: 'customer@example.com', role: 'requester' })

    // Single use: the same token cannot admit a second account.
    await expect(auth.api.signUpEmail({
      body: { email: 'tailgater@example.com', password: 'password123', name: 'Tailgater' },
      headers: withInvite('good-token'),
    })).rejects.toMatchObject({ status: 'FORBIDDEN' })

    repository.createInvite({ id: 'inv-2', tokenHash: hashToken('expired-token'), role: 'requester', expiresAt: Date.now() - 1 })
    await expect(auth.api.signUpEmail({
      body: { email: 'late@example.com', password: 'password123', name: 'Late' },
      headers: withInvite('expired-token'),
    })).rejects.toMatchObject({ status: 'FORBIDDEN' })

    repository.createInvite({ id: 'inv-3', tokenHash: hashToken('revoked-token'), role: 'requester', expiresAt: Date.now() + 60_000 })
    repository.deleteInvite('inv-3')
    await expect(auth.api.signUpEmail({
      body: { email: 'revoked@example.com', password: 'password123', name: 'Revoked' },
      headers: withInvite('revoked-token'),
    })).rejects.toMatchObject({ status: 'FORBIDDEN' })

    expect(repository.countUsers()).toBe(2)
  })

  it('does not let a used invite be revoked back to unused', () => {
    const { repository } = build()
    cleanup = () => repository.close()
    repository.createInvite({ id: 'inv-used', tokenHash: hashToken('token-a'), role: 'requester', expiresAt: Date.now() + 60_000 })
    expect(repository.claimInvite(hashToken('token-a'), Date.now())).toBeTruthy()
    repository.deleteInvite('inv-used')
    expect(repository.findInvite(hashToken('token-a'))?.usedAt).toBeTruthy()
  })
})
