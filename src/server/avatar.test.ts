import { describe, expect, it } from 'vitest'
import { userImage } from './avatar'

describe('user images', () => {
  it('preserves provider images', () => {
    expect(userImage('user@example.com', 'https://cdn.example.com/avatar.png')).toBe('https://cdn.example.com/avatar.png')
  })

  it('uses normalized email for Gravatar fallback', () => {
    expect(userImage(' MyEmailAddress@example.com ')).toBe(
      'https://www.gravatar.com/avatar/0bc83cb571cd1c50ba6f3e8a78ef1346?d=identicon&s=160',
    )
  })
})
