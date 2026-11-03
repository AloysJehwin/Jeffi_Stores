import { CHANNEL_GROUPS, classifyChannel, isPaidChannel, sourceLabel, type ChannelGroup } from './channels'
import { parseUserAgent } from './user-agent'
import type { Attention, ChannelRow, CoreTotals, DrillRow, FunnelBreakdownRow, FunnelStep, ProductRow } from './types'

// Pure maths behind the Traffic tabs: funnel rates, channel roll-ups, product flags, attention rules.

export const rate = (a: number, b: number): number | null => (b > 0 ? a / b : null)
export const change = (cur: number, prev: number): number | null => (prev ? (cur - prev) / Math.abs(prev) : null)

export function buildFunnel(steps: { key: string; label: string; count: number }[], prev: Record<string, number>): FunnelStep[] {
  const first = steps[0]?.count ?? 0
  return steps.map((s, i) => {
    const before = i > 0 ? steps[i - 1] : null
    const p = prev[s.key] ?? 0
    const pBefore = before ? prev[before.key] ?? 0 : 0
    return {
      key: s.key,
      label: s.label,
      count: s.count,
      prevCount: p,
      stepRate: before ? rate(s.count, before.count) : null,
      prevStepRate: before ? rate(p, pBefore) : null,
      overallRate: i === 0 ? (first ? 1 : null) : rate(s.count, first),
      dropOff: before ? Math.max(0, before.count - s.count) : 0,
    }
  })
}

export interface SessionTuple {
  bucket?: string
  source: string | null
  medium: string | null
  campaign: string | null
  gclick: boolean
  refHost: string | null
  sessions: number
  newVisitors: number
  converted: number
  orders: number
  revenue: number
}

export interface OrderTuple {
  source: string | null
  medium: string | null
  campaign: string | null
  gclick: boolean
  mclick: boolean
  orders: number
  revenue: number
}

const sessionChannel = (t: SessionTuple, self: string[]) =>
  classifyChannel({ source: t.source, medium: t.medium, campaign: t.campaign, googleClick: t.gclick, referrerHost: t.refHost }, self)
const orderChannel = (t: OrderTuple) =>
  classifyChannel({ source: t.source, medium: t.medium, campaign: t.campaign, googleClick: t.gclick, metaClick: t.mclick })

/** Sessions by their landing attribution, orders by the order's own click / UTM record. */
export function channelRows(sessions: SessionTuple[], orders: OrderTuple[], self: string[] = []): ChannelRow[] {
  const by = new Map<ChannelGroup, ChannelRow>()
  const get = (g: ChannelGroup) => {
    let r = by.get(g)
    if (!r) {
      const meta = CHANNEL_GROUPS.find(c => c.id === g)!
      r = { channel: g, label: meta.label, paid: meta.paid, sessions: 0, newVisitors: 0, convertedSessions: 0, orders: 0, revenue: 0 }
      by.set(g, r)
    }
    return r
  }
  for (const t of sessions) {
    const r = get(sessionChannel(t, self))
    r.sessions += t.sessions
    r.newVisitors += t.newVisitors
    r.convertedSessions += t.converted
  }
  for (const t of orders) {
    const r = get(orderChannel(t))
    r.orders += t.orders
    r.revenue += t.revenue
  }
  return [...by.values()].sort((a, b) => b.sessions - a.sessions || b.revenue - a.revenue)
}

function drill<T>(rows: T[], key: (r: T) => string | null, add: (d: DrillRow, r: T) => void, into = new Map<string, DrillRow>()) {
  for (const r of rows) {
    const k = key(r)
    if (k == null) continue
    let d = into.get(k)
    if (!d) into.set(k, (d = { key: k, sessions: 0, convertedSessions: 0, orders: 0, revenue: 0 }))
    add(d, r)
  }
  return into
}

const addSessions = (d: DrillRow, t: SessionTuple) => {
  d.sessions += t.sessions
  d.convertedSessions += t.converted
}
const addOrders = (d: DrillRow, t: OrderTuple) => {
  d.orders += t.orders
  d.revenue += t.revenue
}
const sorted = (m: Map<string, DrillRow>, cap: number) =>
  [...m.values()].sort((a, b) => b.sessions - a.sessions || b.revenue - a.revenue).slice(0, cap)

const smKey = (t: { source: string | null; medium: string | null; gclick: boolean }) =>
  `${sourceLabel({ source: t.source, googleClick: t.gclick })} / ${t.medium || '(none)'}`

export function drillDowns(sessions: SessionTuple[], orders: OrderTuple[], self: string[] = [], cap = 100) {
  const isSelf = (h: string) => h === 'localhost' || self.some(s => h === s || h.endsWith('.' + s))
  const sm = drill(orders, smKey, addOrders, drill(sessions, smKey, addSessions))
  const camp = drill(orders, t => t.campaign, addOrders, drill(sessions, t => t.campaign, addSessions))
  const ref = drill(sessions, t => (t.refHost && !isSelf(t.refHost) ? t.refHost : null), (d, t) => {
    addSessions(d, t)
    d.orders += t.orders
    d.revenue += t.revenue
  })
  return { sourceMedium: sorted(sm, cap), campaigns: sorted(camp, cap), referrers: sorted(ref, cap) }
}

export function paidTrend(keys: string[], sessions: SessionTuple[], self: string[] = []) {
  const by = new Map(keys.map(k => [k, { bucket: k, paid: 0, organic: 0 }]))
  for (const t of sessions) {
    const r = t.bucket ? by.get(t.bucket) : undefined
    if (!r) continue
    if (isPaidChannel(sessionChannel(t, self))) r.paid += t.sessions
    else r.organic += t.sessions
  }
  return [...by.values()]
}

export interface UaTuple {
  ua: string | null
  sessions: number
  converted: number
}

/** Sessions and conversions rolled up by a parsed user-agent field. */
export function uaShares(rows: UaTuple[], field: 'device' | 'browser' | 'os', includeBots = false) {
  const by = new Map<string, { key: string; sessions: number; convertedSessions: number }>()
  for (const r of rows) {
    const p = parseUserAgent(r.ua)
    if (!includeBots && p.device === 'Bot') continue
    const k = p[field]
    const e = by.get(k) ?? { key: k, sessions: 0, convertedSessions: 0 }
    e.sessions += r.sessions
    e.convertedSessions += r.converted
    by.set(k, e)
  }
  return [...by.values()].sort((a, b) => b.sessions - a.sessions)
}

export interface FunnelTuple {
  ua: string | null
  source: string | null
  medium: string | null
  campaign: string | null
  gclick: boolean
  refHost: string | null
  sessions: number
  product: number
  cart: number
  checkout: number
  placed: number
  paid: number
}

export function funnelBreakdown(rows: FunnelTuple[], by: 'device' | 'channel', self: string[] = []): FunnelBreakdownRow[] {
  const m = new Map<string, FunnelBreakdownRow>()
  for (const r of rows) {
    const k =
      by === 'device'
        ? parseUserAgent(r.ua).device
        : CHANNEL_GROUPS.find(c => c.id === classifyChannel({ source: r.source, medium: r.medium, campaign: r.campaign, googleClick: r.gclick, referrerHost: r.refHost }, self))!.label
    const e = m.get(k) ?? { key: k, sessions: 0, product: 0, cart: 0, checkout: 0, placed: 0, paid: 0 }
    e.sessions += r.sessions
    e.product += r.product
    e.cart += r.cart
    e.checkout += r.checkout
    e.placed += r.placed
    e.paid += r.paid
    m.set(k, e)
  }
  return [...m.values()].sort((a, b) => b.sessions - a.sessions)
}

const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Opportunities: plenty of views but under 1% of views order. Promote: converts at 5%+ (2+ orders) on
 * at most the median view count. */
export function productFlags(rows: ProductRow[], cap = 10) {
  const viewed = rows.filter(r => r.views > 0)
  const med = median(viewed.map(r => r.views))
  const conv = (r: ProductRow) => r.orders / Math.max(r.views, 1)
  return {
    opportunities: viewed
      .filter(r => r.views >= 20 && conv(r) < 0.01)
      .sort((a, b) => b.views - a.views)
      .slice(0, cap),
    promote: viewed
      .filter(r => r.orders >= 2 && conv(r) >= 0.05 && r.views <= Math.max(med, 1))
      .sort((a, b) => conv(b) - conv(a) || b.orders - a.orders)
      .slice(0, cap),
  }
}

export interface AttentionInput {
  current: CoreTotals
  previous: CoreTotals
  channels: ChannelRow[]
  previousChannels: ChannelRow[]
  laggards: { productId: string; name: string; views: number }[]
  search: { searches: number; zeroResults: number }
  links: { acquisition: string; products: string; search: string; funnel: string; product: (id: string) => string }
}

export function overviewAttention(i: AttentionInput): Attention[] {
  const out: Attention[] = []
  const conv = rate(i.current.convertedSessions, i.current.sessions)
  const prevConv = rate(i.previous.convertedSessions, i.previous.sessions)
  if (conv != null && prevConv && i.current.sessions >= 20 && conv < prevConv * 0.8) {
    out.push({
      key: 'conversion-down',
      severity: 'critical',
      title: `Conversion fell to ${(conv * 100).toFixed(1)}% from ${(prevConv * 100).toFixed(1)}%`,
      sub: 'More than 20% below the previous period',
      href: i.links.funnel,
    })
  }

  const prevBy = new Map(i.previousChannels.map(c => [c.channel, c]))
  for (const c of i.channels) {
    const before = prevBy.get(c.channel)?.sessions ?? 0
    if (c.sessions >= 20 && c.sessions >= before * 1.5 && c.convertedSessions === 0 && c.orders === 0) {
      out.push({
        key: `source-${c.channel}`,
        severity: 'warning',
        title: `${c.label} sessions jumped to ${c.sessions} (from ${before}) with no orders`,
        sub: 'Check the landing pages and offer this traffic sees',
        href: i.links.acquisition,
      })
    }
  }

  for (const p of i.laggards.slice(0, 3)) {
    out.push({
      key: `product-${p.productId}`,
      severity: 'warning',
      title: `${p.name}: ${p.views} views, no orders`,
      sub: 'Check price, images and stock',
      href: i.links.product(p.productId),
    })
  }

  const zr = rate(i.search.zeroResults, i.search.searches)
  if (zr != null && i.search.searches >= 20 && zr > 0.25) {
    out.push({
      key: 'zero-results',
      severity: 'warning',
      title: `${(zr * 100).toFixed(0)}% of searches found nothing`,
      sub: `${i.search.zeroResults} of ${i.search.searches} searches; see the catalogue gaps`,
      href: i.links.search,
    })
  }

  const drop = (t: CoreTotals) => (t.checkoutSessions ? 1 - t.convertedSessions / t.checkoutSessions : null)
  const d = drop(i.current)
  const pd = drop(i.previous)
  if (d != null && i.current.checkoutSessions >= 10 && (pd == null ? d > 0.7 : d > pd + 0.1)) {
    out.push({
      key: 'checkout-dropoff',
      severity: 'critical',
      title: `${(d * 100).toFixed(0)}% of checkouts did not finish${pd != null ? ` (was ${(pd * 100).toFixed(0)}%)` : ''}`,
      sub: 'Checkout drop-off is above usual',
      href: i.links.funnel,
    })
  }
  return out
}
