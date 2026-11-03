import { describe, it, expect } from 'vitest'
import { dmUserIdentifiers, normalizeEmail, normalizePhoneE164, sha256Hex, userIdentifiers } from '@/lib/google-ads/conversions/hash'

describe('normalizeEmail', () => {
  it('drops all whitespace and lowercases every address', () => {
    expect(normalizeEmail('  User.Name+NYC@Example.com ')).toBe('user.name+nyc@example.com')
    expect(normalizeEmail('us er@exam ple.com')).toBe('user@example.com')
  })

  it('drops dots and the +suffix only for gmail.com and googlemail.com', () => {
    expect(normalizeEmail('Jane.Doe+Shopping@googlemail.com')).toBe('janedoe@googlemail.com')
    expect(normalizeEmail('j.o.h.n+ads@GMAIL.com')).toBe('john@gmail.com')
    expect(normalizeEmail('j.o.h.n+ads@gmail.co.in')).toBe('j.o.h.n+ads@gmail.co.in')
  })

  it('rejects anything that is not a single-@ address', () => {
    for (const bad of ['', null, undefined, '   ', 'no-at.example.com', 'a@b@c.com', '@example.com', 'user@', 'user@localhost']) {
      expect(normalizeEmail(bad as any)).toBeNull()
    }
    expect(normalizeEmail('+promo@gmail.com')).toBeNull()
  })
})

describe('normalizePhoneE164', () => {
  it('reads national Indian numbers as +91', () => {
    expect(normalizePhoneE164('9876543210')).toBe('+919876543210')
    expect(normalizePhoneE164('098765 43210')).toBe('+919876543210')
    expect(normalizePhoneE164('91 98765 43210')).toBe('+919876543210')
    expect(normalizePhoneE164('+91 98765-43210')).toBe('+919876543210')
  })

  it('keeps international numbers, with + or a 00 prefix', () => {
    expect(normalizePhoneE164('+1 (800) 555-0200')).toBe('+18005550200')
    expect(normalizePhoneE164('0044 20 7946 0958')).toBe('+442079460958')
  })

  it('returns null for ambiguous or impossible numbers', () => {
    for (const bad of ['', null, '12345', '123456789012345', '+0123456789', '+12', 'call me']) {
      expect(normalizePhoneE164(bad as any)).toBeNull()
    }
  })
})

describe('hashing', () => {
  it('is SHA-256 as 64 lowercase hex characters', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('hashes the normalised values, one identifier each', () => {
    const ids = userIdentifiers(' Jane.Doe+Shopping@GoogleMail.com', '98765 43210')
    expect(ids).toEqual([
      { userIdentifierSource: 'FIRST_PARTY', hashedEmail: '338abf9ef1c8793cadc7bcf51ed595338eb727ed9e06ce3d91d566d60b975937' },
      { userIdentifierSource: 'FIRST_PARTY', hashedPhoneNumber: 'f3a47ce5ce3d4ca8ad15225a245b2759022f79489f5c62719b8c9490f7aab90e' },
    ])
    for (const id of ids) expect(Object.keys(id).filter(k => k.startsWith('hashed'))).toHaveLength(1)
  })

  it('leaves out values that do not normalise', () => {
    expect(userIdentifiers('not-an-email', null)).toEqual([])
    expect(userIdentifiers(null, '9876543210')).toHaveLength(1)
  })

  it('builds Data Manager identifiers: one hex hash per UserIdentifier', () => {
    expect(dmUserIdentifiers(' Jane.Doe+Shopping@GoogleMail.com', '98765 43210')).toEqual([
      { emailAddress: '338abf9ef1c8793cadc7bcf51ed595338eb727ed9e06ce3d91d566d60b975937' },
      { phoneNumber: 'f3a47ce5ce3d4ca8ad15225a245b2759022f79489f5c62719b8c9490f7aab90e' },
    ])
    expect(dmUserIdentifiers('john.smith@EXAMPLE.COM', '+1 (800) 555-0199')).toEqual([
      // Google's own examples (Data Manager offline conversions guide), lowercased.
      { emailAddress: '8e621e3d0368631d263d07a351fa8d34fba0d17c15fbcdec11a5f58008d022a0' },
      { phoneNumber: '78724165620b8a76386cab242569ebc85dd2346f3f5ae88dc13bb57e31020b90' },
    ])
    expect(dmUserIdentifiers(null, 'call me')).toEqual([])
  })
})
