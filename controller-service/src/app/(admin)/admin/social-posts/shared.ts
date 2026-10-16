import type { Tone } from '@/components/admin/channels/ui'

export const PLATFORMS = ['fb', 'ig', 'ig_reel', 'gbp', 'youtube', 'pinterest', 'linkedin', 'x'] as const
export type Platform = (typeof PLATFORMS)[number]

export const PLATFORM_LABEL: Record<Platform, string> = {
  fb: 'Facebook',
  ig: 'Instagram',
  ig_reel: 'Instagram Reel',
  gbp: 'Business Profile',
  youtube: 'YouTube Short',
  pinterest: 'Pinterest',
  linkedin: 'LinkedIn',
  x: 'X',
}

export const PLATFORM_NETWORK: Record<Platform, string> = {
  fb: 'facebook',
  ig: 'instagram',
  ig_reel: 'instagram',
  gbp: 'gbp',
  youtube: 'youtube',
  pinterest: 'pinterest',
  linkedin: 'linkedin',
  x: 'x',
}

// Media each platform must carry; a Reel needs a video though its network (Instagram) needs an image.
export const PLATFORM_REQUIRES: Partial<Record<Platform, { image?: boolean; video?: boolean }>> = {
  ig: { image: true },
  ig_reel: { video: true },
  pinterest: { image: true },
  youtube: { video: true },
}

export const TITLE_PLATFORMS: Platform[] = ['youtube', 'pinterest']

export const label = (p: string) => PLATFORM_LABEL[p as Platform] ?? p

export interface NetworkInfo {
  network: string
  label: string
  status: string
  target: string | null
  tokenExpiry: string | null
  /** How a non-Meta network was connected. */
  via: 'manual' | 'signin' | null
  /** A manual connection carries the store's own app for refreshes. */
  ownApp: boolean
  configured: boolean
  missing: string[]
  redirectUri: string | null
  limits: { caption: number; title?: number; hashtags?: number }
  requires: { image?: boolean; video?: boolean }
  features: { insights: boolean; inbox: boolean; reply: boolean }
}

export interface Post {
  id: string
  group_id: string | null
  platform: Platform
  caption: string | null
  hashtags: string | null
  title: string | null
  link_url: string | null
  image_url: string | null
  image_urls: string[] | null
  video_url: string | null
  scheduled_at: string
  status: 'draft' | 'pending' | 'publishing' | 'posted' | 'failed' | 'cancelled'
  approval_status: 'none' | 'pending' | 'approved' | 'rejected'
  attempts: number
  last_error: string | null
  next_attempt_at: string | null
  posted_id: string | null
  permalink: string | null
  source: string | null
  impressions?: number | null
  reach?: number | null
  likes?: number | null
  comments?: number | null
  shares?: number | null
  saves?: number | null
  clicks?: number | null
  video_views?: number | null
}

export interface Template {
  id: string
  name: string
  caption: string
  hashtags: string | null
}

export const STATUS_TONE: Record<string, Tone> = {
  draft: 'muted',
  pending: 'blue',
  publishing: 'amber',
  posted: 'green',
  failed: 'red',
  cancelled: 'muted',
}

export const APPROVAL_TONE: Record<string, Tone> = { pending: 'amber', approved: 'green', rejected: 'red' }

export const EDITABLE = new Set(['draft', 'pending', 'failed', 'cancelled'])

/** Posts that share a group (one compose to several networks) together, in input order. */
export function groupPosts(posts: Post[]): Post[][] {
  const out = new Map<string, Post[]>()
  for (const p of posts) {
    const k = p.group_id ?? p.id
    const g = out.get(k)
    if (g) g.push(p)
    else out.set(k, [p])
  }
  return [...out.values()]
}

/** ISO string to the DateTimePicker's local 'YYYY-MM-DDTHH:mm'. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null)

export const hashtagCount = (s: string) => (s.match(/#[^\s#]+/g) ?? []).length

/** Fills the template placeholders the autopost job also uses. */
export function fillTemplate(tpl: string, p: { name: string; price: number | null; url: string; oldPrice?: number | null } | null): string {
  if (!p) return tpl
  const rs = (v: number | null | undefined) => (v ? `Rs ${Math.round(v).toLocaleString('en-IN')}` : '')
  return tpl
    .replace(/\{name\}/g, p.name)
    .replace(/\{price\}/g, rs(p.price))
    .replace(/\{old_price\}/g, rs(p.oldPrice))
    .replace(/\{url\}/g, p.url)
}

export function metricsLine(p: Post): string {
  const parts: [string, number | null | undefined][] = [
    ['impressions', p.impressions],
    ['reach', p.reach],
    ['likes', p.likes],
    ['comments', p.comments],
    ['shares', p.shares],
    ['saves', p.saves],
    ['clicks', p.clicks],
    ['views', p.video_views],
  ]
  return parts
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${Number(v).toLocaleString('en-IN')} ${k}`)
    .join(' / ')
}
