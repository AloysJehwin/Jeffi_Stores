import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { signLink, verifyLink } from '../src/short-link'

// secret() reads process.env.SHORT_LINK_SECRET per call, so no re-import needed.
const OLD = process.env.SHORT_LINK_SECRET

describe('short-link — signing disabled', () => {
  beforeEach(() => {
    delete process.env.SHORT_LINK_SECRET
  })
  afterEach(() => {
    if (OLD === undefined) delete process.env.SHORT_LINK_SECRET
    else process.env.SHORT_LINK_SECRET = OLD
  })

  it('signLink returns null with no secret', () => {
    expect(signLink('https://x.test/a')).toBeNull()
  })

  it('verifyLink returns null with no secret', () => {
    expect(verifyLink('abc.def')).toBeNull()
  })
})

describe('short-link — signing enabled', () => {
  beforeEach(() => {
    process.env.SHORT_LINK_SECRET = 'unit-test-secret'
  })
  afterEach(() => {
    if (OLD === undefined) delete process.env.SHORT_LINK_SECRET
    else process.env.SHORT_LINK_SECRET = OLD
  })

  it('signs and round-trips a destination', () => {
    const dest = 'https://shop.jeffistores.in/p/123?x=1'
    const signed = signLink(dest)
    expect(signed).not.toBeNull()
    expect(signed!.token).toContain('.')
    expect(signed!.id).toHaveLength(16)

    const verified = verifyLink(signed!.token)
    expect(verified).not.toBeNull()
    expect(verified!.destination).toBe(dest)
    expect(verified!.id).toBe(signed!.id)
  })

  it('returns null when the token would exceed MAX_TOKEN', () => {
    const huge = 'https://x.test/' + 'a'.repeat(1600)
    expect(signLink(huge)).toBeNull()
  })

  it('verifyLink rejects a token with no dot / dot at position 0', () => {
    expect(verifyLink('nodothere')).toBeNull()
    expect(verifyLink('.leadingdot')).toBeNull()
  })

  it('verifyLink rejects a tampered signature of the right length', () => {
    const signed = signLink('https://x.test/a')!
    const [payload, id] = signed.token.split('.')
    // Flip one char of the sig, keeping its length.
    const badChar = id[0] === 'A' ? 'B' : 'A'
    const tampered = `${payload}.${badChar}${id.slice(1)}`
    expect(verifyLink(tampered)).toBeNull()
  })

  it('verifyLink rejects a signature of the wrong length', () => {
    const signed = signLink('https://x.test/a')!
    const payload = signed.token.split('.')[0]
    expect(verifyLink(`${payload}.short`)).toBeNull()
  })

  it('verifyLink rejects a validly-signed non-http destination', () => {
    const dest = 'ftp://evil.test/x'
    const signed = signLink(dest)!
    // signLink itself does not enforce scheme, but verify must reject it.
    expect(verifyLink(signed.token)).toBeNull()
  })

  it('accepts http:// as well as https://', () => {
    const signed = signLink('http://plain.test/a')!
    expect(verifyLink(signed.token)!.destination).toBe('http://plain.test/a')
  })
})
