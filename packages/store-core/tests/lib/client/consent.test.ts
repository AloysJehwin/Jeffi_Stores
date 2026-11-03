import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  OPEN_COOKIE_SETTINGS_EVENT,
  openCookieSettings,
  parseConsent,
  readConsent,
  saveConsent,
  serializeConsent,
  toGtagConsent,
} from '@/lib/client/consent'
import { CONSENT_COOKIE } from '@/lib/analytics/google-tag'

describe('consent cookie', () => {
  beforeEach(() => {
    document.cookie = `${CONSENT_COOKIE}=; Max-Age=0; Path=/`
    delete (window as unknown as { gtag?: unknown }).gtag
  })

  it('round-trips each choice', () => {
    for (const c of [
      { analytics: true, ads: true },
      { analytics: true, ads: false },
      { analytics: false, ads: true },
      { analytics: false, ads: false },
    ]) {
      expect(parseConsent(serializeConsent(c))).toEqual(c)
    }
  })

  it('rejects unknown formats', () => {
    for (const bad of [null, '', 'v2.1.1', 'v1.1', 'v1.2.0', 'yes']) expect(parseConsent(bad)).toBeNull()
  })

  it('maps to Consent Mode v2 signals (ads covers storage, user data and personalisation)', () => {
    expect(toGtagConsent({ analytics: false, ads: true })).toEqual({
      analytics_storage: 'denied',
      ad_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
    })
  })

  it('has no choice until one is saved, then updates gtag', () => {
    const gtag = vi.fn()
    ;(window as unknown as { gtag: unknown }).gtag = gtag
    expect(readConsent()).toBeNull()
    saveConsent({ analytics: true, ads: false })
    expect(readConsent()).toEqual({ analytics: true, ads: false })
    expect(gtag).toHaveBeenCalledWith('consent', 'update', {
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    })
  })

  it('openCookieSettings dispatches the reopen event', () => {
    const fn = vi.fn()
    window.addEventListener(OPEN_COOKIE_SETTINGS_EVENT, fn)
    openCookieSettings()
    expect(fn).toHaveBeenCalledTimes(1)
    window.removeEventListener(OPEN_COOKIE_SETTINGS_EVENT, fn)
  })
})
