import { describe, it, expect } from 'vitest'
import {
  buildFunnel,
  channelRows,
  drillDowns,
  funnelBreakdown,
  overviewAttention,
  paidTrend,
  productFlags,
  uaShares,
  type SessionTuple,
} from '@/lib/traffic/compute'
import type { CoreTotals, ProductRow } from '@/lib/traffic/types'
import { parseTab } from '@/lib/traffic/types'

const st = (o: Partial<SessionTuple>): SessionTuple => ({
  source: null,
  medium: null,
  campaign: null,
  gclick: false,
  refHost: null,
  sessions: 0,
  newVisitors: 0,
  converted: 0,
  orders: 0,
  revenue: 0,
  ...o,
})

describe('buildFunnel', () => {
  it('computes step, overall and drop-off with the previous period alongside', () => {
    const steps = buildFunnel(
      [
        { key: 'sessions', label: 'Session', count: 200 },
        { key: 'product', label: 'Product', count: 100 },
        { key: 'placed', label: 'Placed', count: 10 },
      ],
      { sessions: 100, product: 40, placed: 8 }
    )
    expect(steps[0]).toMatchObject({ overallRate: 1, stepRate: null, dropOff: 0, prevCount: 100 })
    expect(steps[1]).toMatchObject({ stepRate: 0.5, prevStepRate: 0.4, overallRate: 0.5, dropOff: 100 })
    expect(steps[2]).toMatchObject({ stepRate: 0.1, prevStepRate: 0.2, overallRate: 0.05, dropOff: 90 })
  })

  it('returns null rates on an empty funnel', () => {
    const steps = buildFunnel([{ key: 'a', label: 'A', count: 0 }, { key: 'b', label: 'B', count: 0 }], {})
    expect(steps.map(s => s.overallRate)).toEqual([null, null])
    expect(steps[1].stepRate).toBeNull()
    expect(steps[1].prevStepRate).toBeNull()
  })
})

describe('channel roll-ups', () => {
  const sessions = [
    st({ bucket: '2026-10-01', sessions: 10, converted: 1, newVisitors: 4 }),
    st({ bucket: '2026-10-01', gclick: true, sessions: 5, converted: 2, orders: 2, revenue: 500 }),
    st({ bucket: '2026-10-02', source: 'facebook', medium: 'social', campaign: 'social_7', sessions: 3 }),
    st({ bucket: '2026-10-02', refHost: 'jeffistores.in', sessions: 2 }),
    st({ bucket: '2026-10-02', refHost: 'blog.example', sessions: 4, converted: 1, orders: 1, revenue: 90 }),
  ]
  const orders = [
    { source: null, medium: null, campaign: null, gclick: true, mclick: false, orders: 3, revenue: 900 },
    { source: 'facebook', medium: 'social', campaign: 'social_7', gclick: false, mclick: false, orders: 1, revenue: 100 },
    { source: null, medium: null, campaign: null, gclick: false, mclick: false, orders: 4, revenue: 400 },
  ]

  it('groups sessions by landing and orders by their own attribution', () => {
    const rows = channelRows(sessions, orders, ['jeffistores.in'])
    const by = Object.fromEntries(rows.map(r => [r.channel, r]))
    expect(by.direct).toMatchObject({ sessions: 12, newVisitors: 4, convertedSessions: 1, orders: 4, revenue: 400 })
    expect(by.paid_search).toMatchObject({ sessions: 5, convertedSessions: 2, orders: 3, revenue: 900, paid: true })
    expect(by.organic_social).toMatchObject({ sessions: 3, orders: 1, revenue: 100 })
    expect(by.referral).toMatchObject({ sessions: 4, orders: 0 })
    expect(rows[0].channel).toBe('direct')
  })

  it('drills down by source / medium, campaign and external referrer', () => {
    const d = drillDowns(sessions, orders, ['jeffistores.in'])
    expect(d.sourceMedium.find(r => r.key === 'Google Ads / (none)')).toMatchObject({ sessions: 5, orders: 3, revenue: 900 })
    expect(d.campaigns).toEqual([{ key: 'social_7', sessions: 3, convertedSessions: 0, orders: 1, revenue: 100 }])
    expect(d.referrers.map(r => r.key)).toEqual(['blog.example'])
    expect(d.referrers[0]).toMatchObject({ orders: 1, revenue: 90 })
  })

  it('splits paid and organic sessions per bucket', () => {
    expect(paidTrend(['2026-10-01', '2026-10-02', '2026-10-03'], sessions, ['jeffistores.in'])).toEqual([
      { bucket: '2026-10-01', paid: 5, organic: 10 },
      { bucket: '2026-10-02', paid: 0, organic: 9 },
      { bucket: '2026-10-03', paid: 0, organic: 0 },
    ])
  })
})

describe('user-agent roll-ups', () => {
  const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0 Safari/537.36'
  const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1'
  const BOT = 'Googlebot/2.1'

  it('shares sessions and conversions, bots only under device', () => {
    const rows = [
      { ua: MAC, sessions: 6, converted: 2 },
      { ua: PHONE, sessions: 3, converted: 1 },
      { ua: BOT, sessions: 5, converted: 0 },
    ]
    expect(uaShares(rows, 'device', true)).toEqual([
      { key: 'Desktop', sessions: 6, convertedSessions: 2 },
      { key: 'Bot', sessions: 5, convertedSessions: 0 },
      { key: 'Mobile', sessions: 3, convertedSessions: 1 },
    ])
    expect(uaShares(rows, 'os').map(r => r.key)).toEqual(['macOS', 'iOS'])
  })

  it('breaks the funnel down by device and channel', () => {
    const base = { source: null, medium: null, campaign: null, gclick: false, refHost: null, product: 1, cart: 1, checkout: 1, placed: 1, paid: 0 }
    const rows = [
      { ...base, ua: MAC, sessions: 4 },
      { ...base, ua: PHONE, sessions: 2, gclick: true },
    ]
    expect(funnelBreakdown(rows, 'device').map(r => [r.key, r.sessions])).toEqual([
      ['Desktop', 4],
      ['Mobile', 2],
    ])
    expect(funnelBreakdown(rows, 'channel').map(r => r.key)).toEqual(['Direct', 'Paid search'])
  })
})

const product = (o: Partial<ProductRow>): ProductRow => ({
  productId: 'p',
  name: 'P',
  slug: 'p',
  views: 0,
  uniqueViewers: 0,
  cartAdds: 0,
  orders: 0,
  units: 0,
  revenue: 0,
  wishlisted: 0,
  waiting: 0,
  ...o,
})

describe('productFlags', () => {
  it('finds opportunities and products to promote', () => {
    const rows = [
      product({ productId: 'a', views: 200, orders: 1 }),
      product({ productId: 'b', views: 50, orders: 0 }),
      product({ productId: 'c', views: 10, orders: 3 }),
      product({ productId: 'd', views: 12, orders: 1 }),
      product({ productId: 'e', views: 300, orders: 30 }),
    ]
    const f = productFlags(rows)
    expect(f.opportunities.map(r => r.productId)).toEqual(['a', 'b'])
    expect(f.promote.map(r => r.productId)).toEqual(['c'])
  })
})

const totals = (o: Partial<CoreTotals>): CoreTotals => ({
  visitors: 0,
  sessions: 0,
  pageviews: 0,
  bounces: 0,
  checkoutSessions: 0,
  convertedSessions: 0,
  trackedOrders: 0,
  trackedRevenue: 0,
  orders: 0,
  revenue: 0,
  ...o,
})
const links = { acquisition: '/a', products: '/p', search: '/s', funnel: '/f', product: (id: string) => `/x/${id}` }
const ch = (channel: string, sessions: number, orders = 0) => ({
  channel,
  label: channel,
  paid: false,
  sessions,
  newVisitors: 0,
  convertedSessions: orders,
  orders,
  revenue: 0,
})

describe('overviewAttention', () => {
  it('flags falling conversion, a jumping source with no orders, laggards, zero results and checkout drop-off', () => {
    const items = overviewAttention({
      current: totals({ sessions: 100, convertedSessions: 2, checkoutSessions: 20 }),
      previous: totals({ sessions: 100, convertedSessions: 5, checkoutSessions: 20 }),
      channels: [ch('referral', 40), ch('direct', 60, 2)],
      previousChannels: [ch('referral', 10), ch('direct', 90, 5)],
      laggards: [{ productId: 'p1', name: 'Bolt', views: 80 }],
      search: { searches: 100, zeroResults: 40 },
      links,
    })
    expect(items.map(i => i.key)).toEqual(['conversion-down', 'source-referral', 'product-p1', 'zero-results', 'checkout-dropoff'])
    expect(items.find(i => i.key === 'product-p1')?.href).toBe('/x/p1')
  })

  it('stays quiet when things are steady', () => {
    const t = totals({ sessions: 100, convertedSessions: 5, checkoutSessions: 10 })
    expect(
      overviewAttention({
        current: t,
        previous: t,
        channels: [ch('direct', 100, 5)],
        previousChannels: [ch('direct', 100, 5)],
        laggards: [],
        search: { searches: 100, zeroResults: 5 },
        links,
      })
    ).toEqual([])
  })
})

describe('parseTab', () => {
  it('accepts known tabs and maps the old ones', () => {
    expect(parseTab('funnel')).toBe('funnel')
    expect(parseTab('sources')).toBe('acquisition')
    expect(parseTab('pages')).toBe('behaviour')
    expect(parseTab('nope')).toBe('overview')
    expect(parseTab(null)).toBe('overview')
  })
})
