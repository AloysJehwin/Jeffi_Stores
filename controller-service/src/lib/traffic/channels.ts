import { GOOGLE_ADS_CHANNEL, UNATTRIBUTED_CHANNEL } from '@/lib/analytics/traffic-sources'

// Channel grouping for the Traffic report. The source label matches lib/analytics/traffic-sources
// (a Google click id wins, then utm_source, else unattributed) so the numbers agree with Sources.

export type ChannelGroup =
  | 'direct'
  | 'organic_search'
  | 'paid_search'
  | 'paid_social'
  | 'organic_social'
  | 'email'
  | 'referral'
  | 'marketplace'

export const CHANNEL_GROUPS: { id: ChannelGroup; label: string; paid: boolean }[] = [
  { id: 'direct', label: 'Direct', paid: false },
  { id: 'organic_search', label: 'Organic search', paid: false },
  { id: 'paid_search', label: 'Paid search', paid: true },
  { id: 'paid_social', label: 'Paid social', paid: true },
  { id: 'organic_social', label: 'Social', paid: false },
  { id: 'email', label: 'Email / messaging', paid: false },
  { id: 'referral', label: 'Referral', paid: false },
  { id: 'marketplace', label: 'Marketplace', paid: false },
]

export const channelLabel = (g: ChannelGroup) => CHANNEL_GROUPS.find(c => c.id === g)?.label ?? g
export const isPaidChannel = (g: ChannelGroup) => g === 'paid_search' || g === 'paid_social'

export interface ChannelInput {
  source?: string | null
  medium?: string | null
  campaign?: string | null
  googleClick?: boolean
  metaClick?: boolean
  referrerHost?: string | null
}

const SEARCH = ['google', 'bing', 'yahoo', 'duckduckgo', 'ecosia', 'baidu', 'yandex', 'brave', 'qwant', 'startpage']
const SOCIAL = [
  'facebook', 'fb', 'm.facebook', 'l.facebook', 'lm.facebook', 'instagram', 'ig', 'l.instagram', 'linkedin', 'lnkd',
  'twitter', 'x', 't', 'youtube', 'youtu', 'pinterest', 'pin', 'reddit', 'threads', 'quora', 'snapchat', 'tiktok', 'meta',
]
const MARKET = ['amazon', 'flipkart', 'indiamart', 'meesho', 'justdial', 'tradeindia', 'jiomart', 'snapdeal']
const EMAIL_SRC = ['email', 'newsletter', 'mailchimp', 'sendgrid', 'ses', 'brevo', 'klaviyo', 'whatsapp', 'wa', 'sms']
const EMAIL_MED = ['email', 'e-mail', 'newsletter', 'whatsapp', 'sms', 'messaging']
const PAID_MED = ['cpc', 'ppc', 'paid', 'paidsearch', 'paid_search', 'paid-search', 'cpm', 'cpv', 'display', 'ads', 'ad', 'banner', 'retargeting']
const PAID_SOCIAL_MED = ['paid_social', 'paidsocial', 'paid-social', 'social_paid', 'social-paid', 'sponsored']
const MAIL_HOSTS = ['mail.google', 'outlook', 'mail.yahoo', 'mail.zoho', 'webmail']

/** Host's brand label: "www.l.facebook.com" -> "l.facebook", "google.co.in" -> "google". */
function brand(host: string): string {
  const h = host.toLowerCase().replace(/^www\./, '')
  const parts = h.split('.')
  const tld2 = parts.length > 2 && ['co', 'com', 'org', 'net', 'gov', 'ac'].includes(parts[parts.length - 2])
  return parts.slice(0, parts.length - (tld2 ? 2 : 1)).join('.') || h
}

const matches = (v: string, list: string[]) => {
  const b = v.includes('.') ? brand(v) : v
  const last = b.split('.').pop()!
  return list.includes(b) || list.includes(last)
}

/** Lowercased host of a URL without "www.", or null. */
export function referrerHost(referrer: string | null | undefined): string | null {
  if (!referrer) return null
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/:?#]+)/i.exec(referrer.trim())
  return m ? m[1].toLowerCase().replace(/^www\./, '') : null
}

export function classifyChannel(i: ChannelInput, selfHosts: string[] = []): ChannelGroup {
  const src = (i.source ?? '').trim().toLowerCase()
  const med = (i.medium ?? '').trim().toLowerCase()
  const camp = (i.campaign ?? '').trim().toLowerCase()
  const host = i.referrerHost ? i.referrerHost.toLowerCase().replace(/^www\./, '') : ''

  if (i.googleClick) return 'paid_search'
  if (i.metaClick) return 'paid_social'
  if (PAID_SOCIAL_MED.includes(med)) return 'paid_social'
  if (PAID_MED.includes(med)) return src && matches(src, SOCIAL) ? 'paid_social' : 'paid_search'
  if (src || med) {
    if (EMAIL_MED.includes(med) || (src && matches(src, EMAIL_SRC))) return 'email'
    if (med === 'social' || camp.startsWith('social_') || (src && matches(src, SOCIAL))) return 'organic_social'
    if (src && matches(src, MARKET)) return 'marketplace'
    if (src && matches(src, SEARCH) && (!med || med === 'organic' || med === 'search')) return 'organic_search'
    if (!src && med === 'organic') return 'organic_search'
    return 'referral'
  }
  if (!host || selfHosts.some(s => host === s || host.endsWith('.' + s)) || host === 'localhost') return 'direct'
  if (MAIL_HOSTS.some(m => host.startsWith(m) || host.includes('.' + m))) return 'email'
  if (matches(host, SEARCH)) return 'organic_search'
  if (matches(host, SOCIAL)) return 'organic_social'
  if (matches(host, MARKET)) return 'marketplace'
  return 'referral'
}

/** Source label as Admin Traffic > Sources shows it. */
export function sourceLabel(i: ChannelInput): string {
  if (i.googleClick) return GOOGLE_ADS_CHANNEL
  const src = (i.source ?? '').trim().toLowerCase()
  return src || UNATTRIBUTED_CHANNEL
}

/** Store hosts for spotting internal referrers: the request host without an admin prefix, plus the base URL. */
export function selfHostsFor(requestHost: string | null | undefined, baseUrl?: string | null): string[] {
  const out = new Set<string>()
  const h = (requestHost ?? '').split(':')[0].toLowerCase().replace(/^www\./, '')
  if (h) out.add(h.replace(/^admin(-[a-z0-9-]+)?\./, ''))
  const b = referrerHost(baseUrl ?? null)
  if (b) out.add(b)
  return [...out]
}
