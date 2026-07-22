import { describe, expect, it } from 'vitest'
import { secureResponseCookies } from './authCookies'

describe('auth response cookies', () => {
  it('secures cookies when a reverse proxy forwards HTTPS', () => {
    const response = new Response(null, { headers: { 'set-cookie': 'session=token; Path=/; HttpOnly; SameSite=Lax' } })
    const secured = secureResponseCookies(
      new Request('http://container:3000/api/auth/sign-in/email', { headers: { 'x-forwarded-proto': 'https' } }),
      response,
    )

    expect(secured.headers.getSetCookie()).toEqual(['session=token; Path=/; HttpOnly; SameSite=Lax; Secure'])
  })

  it('leaves cookies usable over direct HTTP', () => {
    const response = new Response(null, { headers: { 'set-cookie': 'session=token; Path=/; HttpOnly; SameSite=Lax' } })
    const unchanged = secureResponseCookies(new Request('http://nas.local/api/auth/sign-in/email'), response)

    expect(unchanged.headers.getSetCookie()).toEqual(['session=token; Path=/; HttpOnly; SameSite=Lax'])
  })
})
