// What a tapped link on a Showcase is, for the analytics page: a contact (call, WhatsApp, email), the map, a social
// profile or another site. Links within the page are none of these. Shared by the tracker and POST /api/track.

export const CLICK_TARGETS = ['call', 'whatsapp', 'email', 'map', 'social', 'link'] as const
export type ClickTarget = (typeof CLICK_TARGETS)[number]

/** The taps that count as an enquiry. */
export const CONTACT_TARGETS: readonly ClickTarget[] = ['call', 'whatsapp', 'email']

const SOCIAL: Record<string, string> = {
  'instagram.com': 'instagram',
  'facebook.com': 'facebook',
  'fb.com': 'facebook',
  'fb.me': 'facebook',
  'youtube.com': 'youtube',
  'youtu.be': 'youtube',
  'x.com': 'x',
  'twitter.com': 'x',
  'linkedin.com': 'linkedin',
  'pinterest.com': 'pinterest',
  'threads.net': 'threads',
  'threads.com': 'threads',
  'behance.net': 'behance',
  'dribbble.com': 'dribbble',
  't.me': 'telegram',
  'telegram.me': 'telegram',
  'snapchat.com': 'snapchat',
  'tiktok.com': 'tiktok',
}

const WHATSAPP = ['wa.me', 'api.whatsapp.com', 'web.whatsapp.com', 'chat.whatsapp.com', 'whatsapp.com']

const isMap = (host: string, path: string) =>
  host === 'maps.app.goo.gl' ||
  host === 'maps.apple.com' ||
  host === 'waze.com' ||
  host.startsWith('maps.google.') ||
  (host === 'goo.gl' && path.startsWith('/maps')) ||
  (/^google\.[a-z.]+$/.test(host) && path.startsWith('/maps')) ||
  (host === 'bing.com' && path.startsWith('/maps'))

const under = (host: string, domain: string) => host === domain || host.endsWith('.' + domain)

/** The kind of link and a short label (the network or host), or null for a link within the page or site. */
export function classifyLink(href: string, siteHost: string): { target: ClickTarget; label?: string } | null {
  const raw = href.trim()
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(raw)?.[1]?.toLowerCase()
  if (scheme === 'tel' || scheme === 'sms') return { target: 'call', label: scheme }
  if (scheme === 'mailto') return { target: 'email' }
  if (scheme === 'whatsapp') return { target: 'whatsapp' }
  if (scheme === 'geo') return { target: 'map' }
  if (scheme !== 'http' && scheme !== 'https') return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '')
  const self = siteHost.toLowerCase().split(':')[0].replace(/^www\./, '')
  if (host === self) return null
  if (WHATSAPP.some(d => under(host, d))) return { target: 'whatsapp' }
  if (isMap(host, url.pathname)) return { target: 'map' }
  const social = Object.keys(SOCIAL).find(d => under(host, d))
  if (social) return { target: 'social', label: SOCIAL[social] }
  return { target: 'link', label: host.slice(0, 120) }
}
