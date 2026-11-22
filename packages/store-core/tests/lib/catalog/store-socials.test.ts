import { describe, it, expect } from 'vitest'
import {
  socialUrl,
  cleanSocials,
  whatsappDigits,
  STORE_SOCIAL_NETWORKS,
  STORE_SOCIAL_LABELS,
  STORE_SOCIAL_KEYS,
} from '@/lib/catalog/store-socials'

describe('constants', () => {
  it('a label and a site_settings key for every network', () => {
    for (const n of STORE_SOCIAL_NETWORKS) {
      expect(STORE_SOCIAL_LABELS[n]).toBeTruthy()
      expect(STORE_SOCIAL_KEYS[n]).toMatch(/^social_/)
    }
  })
})

describe('socialUrl — empties and bad input', () => {
  it("'' for empty, null for overly long / unknown network", () => {
    expect(socialUrl('instagram', '')).toBe('')
    expect(socialUrl('instagram', null)).toBe('')
    expect(socialUrl('instagram', 'a'.repeat(301))).toBeNull()
    expect(socialUrl('nope' as any, 'x')).toBeNull()
  })
})

describe('socialUrl — handles', () => {
  it('builds the profile URL from a bare / @handle', () => {
    expect(socialUrl('instagram', '@yourstore')).toBe('https://www.instagram.com/yourstore')
    expect(socialUrl('instagram', 'yourstore')).toBe('https://www.instagram.com/yourstore')
    expect(socialUrl('youtube', 'mychan')).toBe('https://www.youtube.com/@mychan')
    expect(socialUrl('linkedin', 'acme')).toBe('https://www.linkedin.com/company/acme')
  })

  it('null for a handle that fails the network pattern', () => {
    expect(socialUrl('x', 'waytoolong_handle_here')).toBeNull()
    expect(socialUrl('instagram', 'bad handle!')).toBeNull()
  })
})

describe('socialUrl — URLs', () => {
  it('accepts a full URL on the network and strips www / trailing slash', () => {
    expect(socialUrl('instagram', 'https://www.instagram.com/store/')).toBe('https://www.instagram.com/store')
    // canonical domain → network home origin
    expect(socialUrl('x', 'https://x.com/store')).toBe('https://x.com/store')
    // alt host kept as its own https origin
    expect(socialUrl('x', 'twitter.com/store')).toBe('https://twitter.com/store')
  })

  it('keeps a non-canonical host as https origin', () => {
    expect(socialUrl('youtube', 'https://m.youtube.com/@abc')).toBe('https://www.youtube.com/@abc')
  })

  it('rejects wrong host, non-http(s) scheme, credentials, no path', () => {
    expect(socialUrl('instagram', 'https://evil.com/store')).toBeNull()
    expect(socialUrl('instagram', 'ftp://instagram.com/x')).toBeNull()
    expect(socialUrl('instagram', 'https://user:pw@instagram.com/x')).toBeNull()
    expect(socialUrl('instagram', 'https://instagram.com/')).toBeNull()
  })

  it('facebook profile.php requires a numeric id', () => {
    expect(socialUrl('facebook', 'https://facebook.com/profile.php?id=123')).toBe('https://www.facebook.com/profile.php?id=123')
    expect(socialUrl('facebook', 'https://facebook.com/profile.php')).toBeNull()
    expect(socialUrl('facebook', 'https://facebook.com/profile.php?id=abc')).toBeNull()
  })

  it('returns null for an unparseable URL', () => {
    expect(socialUrl('instagram', 'https://')).toBeNull()
  })
})

describe('cleanSocials', () => {
  it('keeps only networks with a usable link', () => {
    const out = cleanSocials({ instagram: '@a', facebook: 'bad host!!', youtube: '' })
    expect(out).toEqual({ instagram: 'https://www.instagram.com/a' })
  })

  it('returns {} for non-object input', () => {
    expect(cleanSocials(null)).toEqual({})
    expect(cleanSocials('x')).toEqual({})
  })
})

describe('whatsappDigits', () => {
  it("'' for empty", () => {
    expect(whatsappDigits('')).toBe('')
    expect(whatsappDigits(null)).toBe('')
  })

  it('normalises a 10-digit Indian number to 91…', () => {
    expect(whatsappDigits('98765 43210')).toBe('919876543210')
  })

  it('strips a leading 0 off an 11-digit local number then prefixes 91', () => {
    expect(whatsappDigits('09876543210')).toBe('919876543210')
  })

  it('reads a +country number as-is', () => {
    expect(whatsappDigits('+1 415 555 0123')).toBe('14155550123')
  })

  it('strips 00 international prefix', () => {
    expect(whatsappDigits('0014155550123')).toBe('14155550123')
  })

  it('extracts digits from a wa.me link', () => {
    expect(whatsappDigits('https://wa.me/919876543210')).toBe('919876543210')
    expect(whatsappDigits('wa.me/+14155550123')).toBe('14155550123')
  })

  it('null for too-short local, invalid Indian, or out-of-range', () => {
    expect(whatsappDigits('12345')).toBeNull()
    expect(whatsappDigits('910000000000')).toBeNull() // 91 but 3rd digit 0
    expect(whatsappDigits('+0 1234567')).toBeNull()
  })
})
