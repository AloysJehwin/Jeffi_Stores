// The store's WhatsApp number and social profiles (onboarding Store step, Site Controls): what owners type, normalised.
// Pure, so the wizard, the onboarding schema, Site Controls and the site read the same rules.

export const STORE_SOCIAL_NETWORKS = ['instagram', 'facebook', 'youtube', 'x', 'linkedin', 'pinterest'] as const
export type StoreSocialNetwork = (typeof STORE_SOCIAL_NETWORKS)[number]
/** Profile links (absolute https URLs), only the networks set. */
export type StoreSocials = Partial<Record<StoreSocialNetwork, string>>

export const STORE_SOCIAL_LABELS: Record<StoreSocialNetwork, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  x: 'X',
  linkedin: 'LinkedIn',
  pinterest: 'Pinterest',
}

/** site_settings keys. */
export const STORE_WHATSAPP_KEY = 'business_whatsapp'
export const STORE_SOCIAL_KEYS: Record<StoreSocialNetwork, string> = {
  instagram: 'social_instagram',
  facebook: 'social_facebook',
  youtube: 'social_youtube',
  x: 'social_x',
  linkedin: 'social_linkedin',
  pinterest: 'social_pinterest',
}

const on =
  (...domains: string[]) =>
  (host: string) =>
    domains.some(d => host === d || host.endsWith(`.${d}`))

const NETS: Record<StoreSocialNetwork, { host: (h: string) => boolean; domain: string; home: string; handle: RegExp; path: (h: string) => string }> = {
  instagram: { host: on('instagram.com', 'instagr.am'), domain: 'instagram.com', home: 'https://www.instagram.com', handle: /^[a-z0-9._]{1,30}$/i, path: h => `/${h}` },
  facebook: { host: on('facebook.com', 'fb.com', 'fb.me'), domain: 'facebook.com', home: 'https://www.facebook.com', handle: /^[a-z0-9.]{3,50}$/i, path: h => `/${h}` },
  youtube: { host: on('youtube.com', 'youtu.be'), domain: 'youtube.com', home: 'https://www.youtube.com', handle: /^[a-z0-9._-]{3,30}$/i, path: h => `/@${h}` },
  x: { host: on('x.com', 'twitter.com'), domain: 'x.com', home: 'https://x.com', handle: /^[a-z0-9_]{1,15}$/i, path: h => `/${h}` },
  // A bare handle is read as a company page: stores are businesses.
  linkedin: { host: on('linkedin.com'), domain: 'linkedin.com', home: 'https://www.linkedin.com', handle: /^[a-z0-9-]{2,100}$/i, path: h => `/company/${h}` },
  pinterest: { host: h => /(^|\.)pinterest\.(com|co\.[a-z]{2}|[a-z]{2})$/.test(h) || h === 'pin.it', domain: 'pinterest.com', home: 'https://www.pinterest.com', handle: /^[a-z0-9_]{3,30}$/i, path: h => `/${h}` },
}

/**
 * A profile link from a handle (`@yourstore`, `yourstore`) or a URL on the network: an absolute https URL, '' when the
 * input is empty, null when it is neither.
 */
export function socialUrl(network: StoreSocialNetwork, input: unknown): string | null {
  const raw = String(input ?? '').trim()
  if (!raw) return ''
  if (raw.length > 300) return null
  const n = NETS[network]
  if (!n) return null
  const looksLikeUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || raw.includes('/') || n.host(raw.toLowerCase().replace(/^(www|m|mobile)\./, ''))
  if (!looksLikeUrl) {
    const handle = raw.replace(/^@/, '')
    return n.handle.test(handle) ? `${n.home}${n.path(handle)}` : null
  }
  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password) return null
  const host = url.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '')
  if (!n.host(host)) return null
  const path = url.pathname.replace(/\/+$/, '')
  if (!path) return null
  // Facebook profiles without a username are profile.php?id=…
  let query = ''
  if (network === 'facebook' && /^\/profile\.php$/i.test(path)) {
    const id = url.searchParams.get('id')
    if (!id || !/^\d+$/.test(id)) return null
    query = `?id=${id}`
  }
  const origin = host === n.domain ? n.home : `https://${url.hostname.toLowerCase()}`
  return `${origin}${path}${query}`
}

/** Only the networks with a usable link, normalised; anything else is dropped. */
export function cleanSocials(input: unknown): StoreSocials {
  const src = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const out: StoreSocials = {}
  for (const n of STORE_SOCIAL_NETWORKS) {
    const url = socialUrl(n, src[n])
    if (url) out[n] = url
  }
  return out
}

/**
 * A WhatsApp number as digits with the country code (`919876543210`): from `+91 98765 43210`, a 10-digit Indian
 * number, or a wa.me link. '' when the input is empty, null when it is not a number.
 */
export function whatsappDigits(input: unknown): string | null {
  const raw = String(input ?? '').trim()
  if (!raw) return ''
  const fromLink = raw.match(/wa\.me\/\+?(\d+)/i)?.[1]
  let d = (fromLink ?? raw).replace(/\D/g, '')
  if (!fromLink && !raw.startsWith('+')) {
    if (raw.startsWith('00')) d = d.slice(2)
    else {
      if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
      if (d.length === 10) d = `91${d}`
      // Shorter than a number with its country code: a local number we cannot place.
      else if (d.length < 11) return null
    }
  }
  if (d.startsWith('91')) return /^91[1-9]\d{9}$/.test(d) ? d : null
  return /^[1-9]\d{7,14}$/.test(d) ? d : null
}
