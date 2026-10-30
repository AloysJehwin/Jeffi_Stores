import { describe, it, expect, beforeEach } from 'vitest'
import {
  CONSENT_COOKIE,
  FLAGSHIP_GOOGLE_TAG_ID,
  gtagBootstrapScript,
  resolveGoogleTag,
  validateGoogleTagSetting,
} from '@/lib/analytics/google-tag'

describe('validateGoogleTagSetting', () => {
  it('accepts and upper-cases GT-, G- and AW- tag ids', () => {
    expect(validateGoogleTagSetting('google_tag_id', ' g-ab12cd34ef ')).toEqual({ ok: true, value: 'G-AB12CD34EF' })
    expect(validateGoogleTagSetting('google_tag_id', 'GT-NM2C3M85')).toEqual({ ok: true, value: 'GT-NM2C3M85' })
    expect(validateGoogleTagSetting('google_tag_id', 'AW-123456789')).toEqual({ ok: true, value: 'AW-123456789' })
  })

  it('rejects malformed tag ids', () => {
    for (const bad of ['UA-1234-1', 'G-', 'GTM-ABCD12', 'G-AB CD', '<script>']) {
      expect(validateGoogleTagSetting('google_tag_id', bad).ok).toBe(false)
    }
  })

  it('conversion id must be AW- plus digits', () => {
    expect(validateGoogleTagSetting('google_ads_conversion_id', 'aw-987654321')).toEqual({
      ok: true,
      value: 'AW-987654321',
    })
    expect(validateGoogleTagSetting('google_ads_conversion_id', 'G-ABC12345').ok).toBe(false)
    expect(validateGoogleTagSetting('google_ads_conversion_id', 'AW-12ab').ok).toBe(false)
  })

  it('conversion label is the send_to suffix, case kept', () => {
    expect(validateGoogleTagSetting('google_ads_conversion_label', 'AbC-D_efG-h12')).toEqual({
      ok: true,
      value: 'AbC-D_efG-h12',
    })
    expect(validateGoogleTagSetting('google_ads_conversion_label', 'AW-1/abc').ok).toBe(false)
    expect(validateGoogleTagSetting('google_ads_conversion_label', 'abc').ok).toBe(false)
  })

  it('empty clears any field', () => {
    expect(validateGoogleTagSetting('google_ads_conversion_label', '  ')).toEqual({ ok: true, value: '' })
  })
})

describe('resolveGoogleTag', () => {
  const none = { tagId: '', conversionId: '', conversionLabel: '' }

  it('flagship falls back to the historical tag', () => {
    expect(resolveGoogleTag({ ...none, isTenant: false })).toEqual({
      tagIds: [FLAGSHIP_GOOGLE_TAG_ID],
      conversionSendTo: null,
    })
  })

  it('a tenant without a tag loads nothing (no flagship leak)', () => {
    expect(resolveGoogleTag({ ...none, isTenant: true })).toEqual({ tagIds: [], conversionSendTo: null })
  })

  it('uses the store tag, adds the Ads id once and builds send_to', () => {
    expect(
      resolveGoogleTag({
        tagId: 'G-STORE1234',
        conversionId: 'AW-111222333',
        conversionLabel: 'lbl_123',
        isTenant: true,
      })
    ).toEqual({ tagIds: ['G-STORE1234', 'AW-111222333'], conversionSendTo: 'AW-111222333/lbl_123' })
    expect(
      resolveGoogleTag({ tagId: 'AW-111222333', conversionId: 'AW-111222333', conversionLabel: '', isTenant: true })
    ).toEqual({ tagIds: ['AW-111222333'], conversionSendTo: null })
  })

  it('ignores an invalid stored value', () => {
    expect(resolveGoogleTag({ ...none, tagId: 'bogus', isTenant: true }).tagIds).toEqual([])
  })
})

describe('gtagBootstrapScript consent defaults', () => {
  type W = Window & { dataLayer: unknown[][]; jeffiAds?: { sendTo: string | null }; jeffiConsent?: boolean }
  const w = window as unknown as W
  const run = (src: string) => new Function(src)()
  const calls = () => w.dataLayer.map(a => Array.from(a as ArrayLike<unknown>))
  const cfg = { tagIds: ['G-STORE1234', 'AW-111222333'], conversionSendTo: 'AW-111222333/lbl_123' }

  beforeEach(() => {
    w.dataLayer = []
    delete w.jeffiConsent
    document.cookie = `${CONSENT_COOKIE}=; Max-Age=0; Path=/`
  })

  it('denies every storage type before config when no choice is stored', () => {
    run(gtagBootstrapScript(cfg, true))
    const c = calls()
    expect(c[0]).toEqual([
      'consent',
      'default',
      {
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
        analytics_storage: 'denied',
        wait_for_update: 500,
      },
    ])
    expect(c.some(x => x[0] === 'consent' && x[1] === 'update')).toBe(false)
    const firstConfig = c.findIndex(x => x[0] === 'config')
    expect(firstConfig).toBeGreaterThan(0)
    expect(c.filter(x => x[0] === 'config').map(x => x[1])).toEqual(['G-STORE1234', 'AW-111222333'])
    expect(w.jeffiAds).toEqual({ sendTo: 'AW-111222333/lbl_123' })
    expect(w.jeffiConsent).toBe(true)
  })

  it('applies a stored choice before config fires', () => {
    document.cookie = `${CONSENT_COOKIE}=v1.1.0; Path=/`
    run(gtagBootstrapScript(cfg, true))
    const c = calls()
    const update = c.findIndex(x => x[0] === 'consent' && x[1] === 'update')
    expect(c[update][2]).toEqual({
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    })
    expect(update).toBeLessThan(c.findIndex(x => x[0] === 'config'))
  })

  it('sets no consent state off the storefront', () => {
    run(gtagBootstrapScript(cfg, false))
    expect(calls().some(x => x[0] === 'consent')).toBe(false)
    expect(w.jeffiConsent).toBeUndefined()
  })
})
