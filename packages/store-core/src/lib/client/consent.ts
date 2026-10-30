import { CONSENT_COOKIE } from '@/lib/analytics/google-tag'

// Storefront cookie consent: stored as `v1.<analytics>.<ads>` (1/0) in a first-party cookie and
// mirrored to Google Consent Mode v2. The inline bootstrap in layout.tsx reads the same cookie.

export interface ConsentChoice {
  analytics: boolean
  ads: boolean
}

export const CONSENT_MAX_AGE_DAYS = 180
export const OPEN_COOKIE_SETTINGS_EVENT = 'jeffi:open-cookie-settings'

export function serializeConsent(c: ConsentChoice): string {
  return `v1.${c.analytics ? 1 : 0}.${c.ads ? 1 : 0}`
}

export function parseConsent(raw: string | null | undefined): ConsentChoice | null {
  if (!raw) return null
  const p = decodeURIComponent(raw).split('.')
  if (p.length !== 3 || p[0] !== 'v1') return null
  if (!['0', '1'].includes(p[1]) || !['0', '1'].includes(p[2])) return null
  return { analytics: p[1] === '1', ads: p[2] === '1' }
}

export function toGtagConsent(c: ConsentChoice) {
  const ads = c.ads ? 'granted' : 'denied'
  return {
    analytics_storage: c.analytics ? 'granted' : 'denied',
    ad_storage: ads,
    ad_user_data: ads,
    ad_personalization: ads,
  } as const
}

export function readConsent(): ConsentChoice | null {
  if (typeof document === 'undefined') return null
  const m = document.cookie.match(new RegExp(`(?:^|; )${CONSENT_COOKIE}=([^;]*)`))
  return parseConsent(m?.[1])
}

type Gtag = (...args: unknown[]) => void

export function saveConsent(c: ConsentChoice): void {
  if (typeof document === 'undefined') return
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${CONSENT_COOKIE}=${serializeConsent(c)}; Path=/; Max-Age=${CONSENT_MAX_AGE_DAYS * 86400}; SameSite=Lax${secure}`
  const gtag = (window as unknown as { gtag?: Gtag }).gtag
  if (typeof gtag === 'function') gtag('consent', 'update', toGtagConsent(c))
}

export function openCookieSettings(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OPEN_COOKIE_SETTINGS_EVENT))
}
