import { describe, it, expect } from 'vitest'
import {
  ATTRIBUTION_MAX_AGE_S,
  attributionCookieOptions,
  decodeAttribution,
  encodeAttribution,
  hasClickId,
  mergeAttribution,
  parseAttribution,
} from '@controller/lib/attribution/capture'

const NOW = new Date('2026-11-24T10:00:00Z')

describe('parseAttribution', () => {
  it('keeps the click ids and UTM tags it knows, from a record or a query string', () => {
    const q = new URLSearchParams('gclid=Cj0K_abc-1&gbraid=GB1&wbraid=WB1&utm_source=google&utm_medium=cpc&utm_campaign=ecom_store&utm_term=online+store&utm_content=ad1&x=1')
    const a = parseAttribution(q, '/pricing', NOW)!
    expect(a).toMatchObject({ gclid: 'Cj0K_abc-1', gbraid: 'GB1', wbraid: 'WB1', landingPath: '/pricing', seenAt: NOW.toISOString() })
    expect(a.utm).toEqual({ utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'ecom_store', utm_term: 'online store', utm_content: 'ad1' })
    expect(parseAttribution({ gclid: 'abc' }, undefined, NOW)).toMatchObject({ gclid: 'abc' })
  })

  it('returns null with nothing to capture', () => {
    expect(parseAttribution(new URLSearchParams('page=2&ref=x'))).toBeNull()
    expect(parseAttribution(null)).toBeNull()
    expect(parseAttribution({})).toBeNull()
  })

  it('drops click ids with odd characters or an absurd length, and non-path landings', () => {
    expect(parseAttribution({ gclid: '<script>' })).toBeNull()
    expect(parseAttribution({ gclid: 'a'.repeat(300) })).toBeNull()
    expect(parseAttribution({ utm_source: 'google' }, 'https://evil.test/')!.landingPath).toBeUndefined()
  })
})

describe('mergeAttribution', () => {
  const click = parseAttribution({ gclid: 'g1' }, '/', NOW)!
  const utmOnly = parseAttribution({ utm_source: 'newsletter' }, '/', NOW)!
  const newer = parseAttribution({ gclid: 'g2' }, '/pricing', NOW)!

  it('a newer click replaces the old one', () => expect(mergeAttribution(click, newer).gclid).toBe('g2'))
  it('a UTM-only landing never replaces a click id', () => expect(mergeAttribution(click, utmOnly).gclid).toBe('g1'))
  it('takes the new capture when there is none yet', () => expect(mergeAttribution(null, utmOnly)).toBe(utmOnly))
  it('knows click ids', () => {
    expect(hasClickId(click)).toBe(true)
    expect(hasClickId(utmOnly)).toBe(false)
    expect(hasClickId(null)).toBe(false)
  })
})

describe('cookie value', () => {
  it('round-trips', () => {
    const a = parseAttribution({ gclid: 'g1', utm_campaign: 'ecom_store' }, '/pricing', NOW)!
    expect(decodeAttribution(encodeAttribution(a))).toEqual(a)
  })

  it('reads a broken or empty cookie as nothing', () => {
    expect(decodeAttribution('{nope')).toBeNull()
    expect(decodeAttribution('')).toBeNull()
    expect(decodeAttribution(undefined)).toBeNull()
    expect(decodeAttribution('{"utm":{}}')).toBeNull()
  })

  it('is a 90-day, first-party, SameSite=Lax cookie', () => {
    expect(ATTRIBUTION_MAX_AGE_S).toBe(90 * 24 * 3600)
    expect(attributionCookieOptions()).toMatchObject({ sameSite: 'lax', maxAge: ATTRIBUTION_MAX_AGE_S, httpOnly: true, path: '/' })
  })
})
