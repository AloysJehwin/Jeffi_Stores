import { describe, it, expect, beforeEach } from 'vitest'
import { signLink, verifyLink } from '../../../tenancy/src/short-link'

describe('signed short links', () => {
  beforeEach(() => { process.env.SHORT_LINK_SECRET = 'test-secret' })

  it('round-trips a destination', () => {
    const s = signLink('https://jeffistores.in/p/abc?x=1')!
    expect(s.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{16}$/)
    expect(verifyLink(s.token)).toEqual({ destination: 'https://jeffistores.in/p/abc?x=1', id: s.id })
  })
  it('rejects a tampered destination or signature', () => {
    const s = signLink('https://jeffistores.in/')!
    const other = Buffer.from('https://evil.example/').toString('base64url')
    expect(verifyLink(`${other}.${s.id}`)).toBeNull()
    expect(verifyLink(s.token.slice(0, -1) + (s.token.endsWith('A') ? 'B' : 'A'))).toBeNull()
  })
  it('rejects a token signed with another secret and non-http destinations', () => {
    const s = signLink('https://jeffistores.in/')!
    process.env.SHORT_LINK_SECRET = 'other'
    expect(verifyLink(s.token)).toBeNull()
    expect(verifyLink(signLink('javascript:alert(1)')!.token)).toBeNull()
  })
  it('is off without a secret', () => {
    process.env.SHORT_LINK_SECRET = ''
    expect(signLink('https://jeffistores.in/')).toBeNull()
  })
})
