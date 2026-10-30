import { describe, it, expect, vi, beforeEach } from 'vitest'

const { queryOne, queryMany, sendAuditedMail } = vi.hoisted(() => ({ queryOne: vi.fn(), queryMany: vi.fn(), sendAuditedMail: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne, queryMany, query: vi.fn() }))
vi.mock('@/lib/shared/mail-audit', () => ({ sendAuditedMail }))
vi.mock('@/lib/catalog/brand', () => ({ currentBrandNameAsync: async () => 'Acme', currentAdminBaseUrlAsync: async () => 'https://admin.jeffistores.in/admin' }))
vi.mock('@/lib/shared/daily-briefing', () => ({ briefingFromAsync: async () => 'Acme Ops <ops@x.in>' }))
vi.mock('@/lib/google-ads/attribution', async () => {
  const actual = await vi.importActual<any>('@/lib/google-ads/attribution')
  return {
    ...actual,
    googleAdsOrderStats: vi.fn(async (r: any) =>
      r.from === '2026-10-12'
        ? { available: true, orders: 5, revenue: 10000, refunds: 0, tax: 1000, cogs: 5000 }
        : { available: true, orders: 4, revenue: 6000, refunds: 0, tax: 600, cogs: 3000 }
    ),
  }
})

import { collectDigest, digestRanges, rankCampaigns, renderDigest, sendWeeklyDigest } from '@/lib/google-ads/digest'

const NOW = new Date('2026-10-19T04:00:00Z') // Monday 09:30 IST

beforeEach(() => {
  vi.clearAllMocks()
  queryOne.mockImplementation(async (sql: string, p?: any[]) => {
    if (sql.includes('FROM ads_account')) return { time_zone: 'Asia/Kolkata', currency_code: 'INR' }
    if (sql.includes('FROM ads_daily_metrics')) return p?.[0] === '2026-10-12' ? { cost_micros: 2_000_000_000, clicks: 300, conversions: 6, value: 9000 } : { cost_micros: 1_500_000_000, clicks: 200, conversions: 4, value: 5000 }
    if (sql.includes('FROM site_settings WHERE key')) return null
    if (sql.includes('INSERT INTO site_settings')) return { key: 'google_ads_digest_last_period' }
    return null
  })
  queryMany.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM ads_campaigns c JOIN')) return [
      { name: 'Brand', cost_micros: 500_000_000, conversions: 4, value: 6000 },
      { name: 'Shopping', cost_micros: 1_000_000_000, conversions: 2, value: 3000 },
      { name: 'Broad', cost_micros: 500_000_000, conversions: 0, value: 0 },
    ]
    if (sql.includes('FROM ads_search_terms')) return [{ search_term: 'free drill <manual>', cost_micros: 300_000_000, clicks: 12 }]
    if (sql.includes('FROM ads_alerts')) return [{ title: 'Tracking stopped', severity: 'critical', status: 'open' }]
    if (sql.includes('FROM admins')) return [{ role: 'super_admin', scopes: [], email: 'owner@store.in' }]
    return []
  })
})

describe('weekly digest', () => {
  it('compares the last 7 complete days with the 7 before', () => {
    expect(digestRanges('2026-10-19')).toEqual({ range: { from: '2026-10-12', to: '2026-10-18' }, previous: { from: '2026-10-05', to: '2026-10-11' } })
  })

  it('ranks best by ROAS among converting campaigns and worst by the lowest ROAS', () => {
    const r = rankCampaigns([
      { name: 'A', cost: 10, conversions: 1, value: 50, roas: 5 },
      { name: 'B', cost: 10, conversions: 1, value: 20, roas: 2 },
      { name: 'C', cost: 30, conversions: 0, value: 0, roas: 0 },
      { name: 'D', cost: 0, conversions: 0, value: 0, roas: null },
    ])
    expect(r.top.map(c => c.name)).toEqual(['A', 'B'])
    expect(r.worst.map(c => c.name)).toEqual(['C'])
  })

  it('collects spend, our revenue, true ROAS / POAS, campaigns, wasted terms and alerts', async () => {
    const d = await collectDigest(NOW)
    expect(d.current).toMatchObject({ cost: 2000, conversions: 6, orders: 5 })
    expect(d.current.returns).toMatchObject({ netRevenue: 10000, trueRoas: 5, poas: 2 })
    expect(d.prior.returns.trueRoas).toBe(4)
    expect(d.top.map(c => c.name)).toEqual(['Brand', 'Shopping'])
    expect(d.worst.map(c => c.name)).toEqual(['Broad'])
    expect(d.wasted).toEqual([{ term: 'free drill <manual>', cost: 300, clicks: 12 }])
    expect(d.alerts).toEqual([{ title: 'Tracking stopped', severity: 'critical' }])
    const { subject, html } = renderDigest(d, 'Acme', 'https://admin/google-ads?tab=overview')
    expect(subject).toBe('Google Ads week 2026-10-12 to 2026-10-18: ₹2,000 spent, true ROAS 5.00x')
    expect(html).toContain('True ROAS')
    expect(html).toContain('POAS')
    expect(html).toContain('free drill &lt;manual&gt;')
    expect(html).toContain('Tracking stopped')
    expect(html).toContain('+33%')
  })

  it('sends once per week to admins with Google Ads access, with a link to the console', async () => {
    const r = await sendWeeklyDigest({ now: NOW })
    expect(r).toEqual({ status: 'sent', sent: 1, failed: 0 })
    const mail = sendAuditedMail.mock.calls[0][0]
    expect(mail).toMatchObject({ to: 'owner@store.in', kind: 'google_ads_digest' })
    expect(mail.html).toContain('https://admin.jeffistores.in/google-ads?tab=overview')
    queryOne.mockImplementation(async (sql: string) => (sql.includes('INSERT INTO site_settings') ? null : sql.includes('FROM ads_daily_metrics') ? { cost_micros: 1 } : null))
    expect(await sendWeeklyDigest({ now: NOW })).toMatchObject({ status: 'skipped', reason: 'already_sent' })
  })

  it('honours the opt-out on the schedule but not on demand', async () => {
    const base = queryOne.getMockImplementation()!
    queryOne.mockImplementation(async (sql: string, p?: any[]) => (p?.[0] === 'google_ads_digest_enabled' ? { value: 'false' } : base(sql, p)))
    expect(await sendWeeklyDigest({ now: NOW })).toMatchObject({ status: 'skipped', reason: 'disabled' })
    expect(await sendWeeklyDigest({ now: NOW, to: ['me@store.in'] })).toMatchObject({ status: 'sent', sent: 1 })
  })
})
