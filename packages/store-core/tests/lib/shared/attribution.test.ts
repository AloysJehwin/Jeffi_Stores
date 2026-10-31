import { describe, it, expect, beforeEach } from 'vitest'
import {
  ATTRIBUTION_COOKIE,
  attributionFromCookieHeader,
  captureAttribution,
  hasClickId,
  isExpired,
  mergeAttribution,
  parseAttribution,
  parseLandingParams,
  serializeAttribution,
} from '@/lib/shared/attribution'

const DAY = 86400000
const NOW = Date.UTC(2026, 9, 16, 12)

describe('parseLandingParams', () => {
  it('reads click ids, UTMs and the landing path', () => {
    const a = parseLandingParams(
      '?gclid=Cj0K&utm_source=google&utm_medium=cpc&utm_campaign=diwali&utm_term=bolts&utm_content=ad1&x=1',
      '/products/bolt',
      NOW
    )
    expect(a).toEqual({
      gclid: 'Cj0K',
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'diwali',
      utm_term: 'bolts',
      utm_content: 'ad1',
      landing_path: '/products/bolt',
      ts: NOW,
    })
  })

  it('accepts gbraid / wbraid and a search string without "?"', () => {
    expect(parseLandingParams('gbraid=g1', '/', NOW)).toMatchObject({ gbraid: 'g1' })
    expect(parseLandingParams('?wbraid=w1', '/', NOW)).toMatchObject({ wbraid: 'w1' })
  })

  it('is null for a direct visit and ignores blank values', () => {
    expect(parseLandingParams('', '/', NOW)).toBeNull()
    expect(parseLandingParams('?q=bolt&gclid=%20', '/', NOW)).toBeNull()
  })

  it('strips control characters and caps length', () => {
    const a = parseLandingParams(`?utm_campaign=a%0Ab&gclid=${'x'.repeat(400)}`, '/', NOW)!
    expect(a.utm_campaign).toBe('ab')
    expect(a.gclid).toHaveLength(255)
  })
})

describe('mergeAttribution (last non-direct click wins)', () => {
  const old = { utm_source: 'facebook', landing_path: '/', ts: NOW - 10 * DAY }
  const fresh = { gclid: 'new', landing_path: '/p', ts: NOW }

  it('a new click replaces the stored one', () => {
    expect(mergeAttribution(old, fresh, NOW)).toBe(fresh)
  })

  it('a direct visit keeps the stored click', () => {
    expect(mergeAttribution(old, null, NOW)).toBe(old)
  })

  it('drops a stored click older than 90 days', () => {
    expect(mergeAttribution({ ...old, ts: NOW - 91 * DAY }, null, NOW)).toBeNull()
    expect(isExpired({ ...old, ts: NOW - 89 * DAY }, NOW)).toBe(false)
  })
})

describe('cookie round trip', () => {
  it('serialises and parses back', () => {
    const a = { gclid: 'abc', utm_source: 'google', landing_path: '/x?y', ts: NOW - DAY }
    expect(parseAttribution(serializeAttribution(a), NOW)).toEqual(a)
  })

  it('rejects junk, expired and attribution-less cookies', () => {
    expect(parseAttribution('not-json', NOW)).toBeNull()
    expect(
      parseAttribution(serializeAttribution({ gclid: 'a', landing_path: '/', ts: NOW - 100 * DAY }), NOW)
    ).toBeNull()
    expect(parseAttribution(encodeURIComponent(JSON.stringify({ landing_path: '/', ts: NOW })), NOW)).toBeNull()
    expect(parseAttribution(encodeURIComponent(JSON.stringify({ gclid: 5, utm_source: 's', ts: NOW })), NOW)).toEqual({
      utm_source: 's',
      landing_path: '/',
      ts: NOW,
    })
  })

  it('finds the cookie in a Cookie header', () => {
    const v = serializeAttribution({ wbraid: 'w', landing_path: '/', ts: NOW })
    expect(attributionFromCookieHeader(`a=1; ${ATTRIBUTION_COOKIE}=${v}; b=2`, NOW)).toMatchObject({ wbraid: 'w' })
    expect(attributionFromCookieHeader('a=1', NOW)).toBeNull()
    expect(attributionFromCookieHeader(null, NOW)).toBeNull()
  })

  it('hasClickId', () => {
    expect(hasClickId({ gbraid: 'g' })).toBe(true)
    expect(hasClickId({ utm_source: 'google' })).toBe(false)
    expect(hasClickId(null)).toBe(false)
  })
})

describe('captureAttribution (browser)', () => {
  beforeEach(() => {
    document.cookie = `${ATTRIBUTION_COOKIE}=; Max-Age=0; Path=/`
  })

  it('stores a landing click and keeps it across a later direct page', () => {
    window.history.pushState({}, '', '/products/bolt?gclid=G1&utm_source=google')
    expect(captureAttribution(NOW)).toMatchObject({ gclid: 'G1', landing_path: '/products/bolt' })
    window.history.pushState({}, '', '/cart')
    expect(captureAttribution(NOW + DAY)).toMatchObject({ gclid: 'G1', landing_path: '/products/bolt' })
  })

  it('replaces the stored click with a newer one', () => {
    window.history.pushState({}, '', '/?gclid=G1')
    captureAttribution(NOW)
    window.history.pushState({}, '', '/?utm_source=newsletter&utm_medium=email')
    const a = captureAttribution(NOW + DAY)!
    expect(a.gclid).toBeUndefined()
    expect(a.utm_source).toBe('newsletter')
  })
})
