import { describe, expect, it } from 'vitest'
import { authProvisioningAllowed, claimAuthInvite, claimedAuthInvite, withAuthInvite, withAuthProvisioning } from './authInvite'

describe('auth invite context', () => {
  it('claims an invite at most once inside an auth flow', () => {
    let calls = 0
    const invite = { id: 'invite', role: 'requester' as const, createdAt: 1, expiresAt: 2 }
    withAuthInvite('token', () => {
      expect(
        claimAuthInvite((token) => {
          calls += 1
          expect(token).toBe('token')
          return invite
        }),
      ).toBe(invite)
      expect(
        claimAuthInvite(() => {
          calls += 1
          return undefined
        }),
      ).toBe(invite)
      expect(claimedAuthInvite()).toBe(invite)
    })
    expect(calls).toBe(1)
  })

  it('isolates explicit admin provisioning', () => {
    expect(authProvisioningAllowed()).toBe(false)
    withAuthProvisioning(() => expect(authProvisioningAllowed()).toBe(true))
    expect(authProvisioningAllowed()).toBe(false)
  })
})
