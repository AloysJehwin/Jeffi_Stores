import { describe, it, expect, vi, beforeEach } from 'vitest'

const { query, queryOne, queryMany, createAdminNotification, sendAuditedMail } = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  createAdminNotification: vi.fn(),
  sendAuditedMail: vi.fn(),
}))
vi.mock('@/lib/shared/db', () => ({ query, queryOne, queryMany }))
vi.mock('@/lib/shared/admin-notify', () => ({ createAdminNotification }))
vi.mock('@/lib/shared/mail-audit', () => ({ sendAuditedMail }))
vi.mock('@/lib/catalog/brand', () => ({
  currentBrandNameAsync: async () => 'Acme',
  currentAdminBaseUrlAsync: async () => 'https://admin-acme.jeffistores.in',
}))
vi.mock('@/lib/shared/daily-briefing', () => ({ briefingFromAsync: async () => 'Acme Ops <ops@x.in>' }))

import {
  DEFAULT_ALERT_CONFIG,
  alertsToNotify,
  applyFindings,
  completeDays,
  evaluateRules,
  mergeConfig,
  notifyAlerts,
  renderAlertsEmail,
  type AlertSnapshot,
} from '@/lib/google-ads/alerts'

const base: AlertSnapshot = {
  today: '2026-10-16',
  hour: 11,
  currency: 'INR',
  campaigns: [],
  daily: [],
  campaignWindow: [],
  attributedOrders: null,
  window: { cost: 0, conversions: 0, trueRoas: null, googleRoas: null },
  disapprovedAds: [],
  merchantDisapproved: [],
  outOfStock: [],
  account: { status: 'ENABLED', budgetStatus: null, budgetLimit: null, budgetServed: null },
}
const days = (costs: number[], clicks = 10) =>
  costs.map((cost, i) => {
    const d = new Date('2026-10-16T00:00:00Z')
    d.setUTCDate(d.getUTCDate() - (costs.length - 1 - i))
    return { date: d.toISOString().slice(0, 10), cost, clicks, conversions: 1 }
  })
const keys = (s: Partial<AlertSnapshot>, cfg = DEFAULT_ALERT_CONFIG) => evaluateRules({ ...base, ...s }, cfg).map(f => f.key)

describe('alert rules', () => {
  it('budget pacing: spent past the threshold before the hour, and limited by budget', () => {
    const c = { campaignId: '1', name: 'Drills', dailyBudget: 1000, todayCost: 850, limitedByBudget: true }
    expect(keys({ campaigns: [c] })).toEqual(['budget_pacing:1:2026-10-16', 'budget_limited:1'])
    expect(keys({ campaigns: [{ ...c, limitedByBudget: false }], hour: 15 })).toEqual([])
    expect(keys({ campaigns: [{ ...c, todayCost: 500, limitedByBudget: false }] })).toEqual([])
  })

  it('spend spike against the 7 days before yesterday', () => {
    expect(keys({ daily: days([100, 100, 100, 100, 100, 100, 100, 600, 50]) })).toEqual(['spend_spike:2026-10-15'])
    expect(keys({ daily: days([100, 100, 100, 100, 100, 100, 100, 140, 50]) })).toEqual([])
    expect(keys({ daily: days([10, 10, 10, 10, 10, 10, 10, 60, 0]) })).toEqual([])
  })

  it('CPA and ROAS targets only when set, preferring true ROAS', () => {
    const window = { cost: 1000, conversions: 2, trueRoas: 1.5, googleRoas: 6 }
    expect(keys({ window })).toEqual([])
    const cfg = { ...DEFAULT_ALERT_CONFIG, cpa_roas_target: { enabled: true, maxCpa: 300, minRoas: 2, days: 7 } }
    expect(keys({ window }, cfg)).toEqual(['cpa_target', 'roas_target'])
    expect(keys({ window: { ...window, trueRoas: null } }, cfg)).toEqual(['cpa_target'])
  })

  it('zero conversions while spending, per campaign', () => {
    expect(keys({ campaignWindow: [{ campaignId: '7', name: 'X', cost: 400, conversions: 0 }, { campaignId: '8', name: 'Y', cost: 100, conversions: 0 }] })).toEqual([
      'zero_conversions:7',
    ])
  })

  it('tracking stopped only when the store records click ids', () => {
    expect(keys({ attributedOrders: 0, daily: days([1, 1, 1, 1], 20) })).toEqual(['tracking_stopped'])
    expect(keys({ attributedOrders: 2, daily: days([1, 1, 1, 1], 20) })).toEqual([])
    expect(keys({ attributedOrders: null, daily: days([1, 1, 1, 1], 20) })).toEqual([])
  })

  it('disapproved ads, Merchant disapprovals, out-of-stock spend and account problems', () => {
    const f = evaluateRules(
      {
        ...base,
        disapprovedAds: [{ adGroupId: '2', adId: '3', name: 'RSA', campaignName: 'C', topics: ['destination not working'] }],
        merchantDisapproved: [{ itemId: 'sku1', title: 'Drill', cost: 50 }],
        outOfStock: [{ itemId: 'sku2', title: 'Saw', sku: 'SKU2', cost: 80 }],
        account: { status: 'SUSPENDED', budgetStatus: 'CANCELLED', budgetLimit: 1000, budgetServed: 950 },
      },
      DEFAULT_ALERT_CONFIG
    )
    expect(f.map(x => x.key)).toEqual([
      'disapproved_ad:2~3',
      'merchant_disapproved:sku1',
      'oos_ads:sku2',
      'account_status',
      'account_budget:CANCELLED',
      'account_budget_low',
    ])
    expect(f.find(x => x.key === 'account_status')!.severity).toBe('critical')
  })

  it('disabled rules find nothing', () => {
    const cfg = mergeConfig(JSON.stringify({ disapproved_ads: { enabled: false } }))
    expect(keys({ disapprovedAds: [{ adGroupId: '2', adId: '3', name: null, campaignName: null, topics: [] }] }, cfg)).toEqual([])
  })

  it('merges stored settings over defaults and drops invalid ones', () => {
    const cfg = mergeConfig(JSON.stringify({ spend_spike: { percent: 80 }, budget_pacing: { pacePercent: 5000 } }))
    expect(cfg.spend_spike).toEqual({ enabled: true, percent: 80, minSpend: 500 })
    expect(cfg.budget_pacing).toEqual(DEFAULT_ALERT_CONFIG.budget_pacing)
    expect(mergeConfig('not json')).toEqual(DEFAULT_ALERT_CONFIG)
  })

  it('complete days stop before today', () => {
    expect(completeDays('2026-10-16', 3)).toEqual(['2026-10-13', '2026-10-15'])
  })
})

describe('de-duplication and notification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    query.mockResolvedValue({ rowCount: 0, rows: [] })
    queryMany.mockResolvedValue([])
  })

  it('keeps one alert per key: refreshes open ones, inserts new, resolves cleared', async () => {
    queryOne.mockImplementation(async (sql: string, p: any[]) => {
      if (sql.startsWith('UPDATE ads_alerts')) return p[0] === 'old' ? { id: '1' } : null
      if (sql.startsWith('INSERT INTO ads_alerts')) return { id: '2', dedupe_key: p[1], severity: p[2], title: p[3] }
      return null
    })
    query.mockResolvedValue({ rowCount: 3 })
    const findings = [
      { rule: 'spend_spike', key: 'old', severity: 'warning', title: 'a', message: '' },
      { rule: 'spend_spike', key: 'new', severity: 'warning', title: 'b', message: '' },
      { rule: 'spend_spike', key: 'new', severity: 'warning', title: 'b', message: '' },
    ] as any
    const r = await applyFindings(findings)
    expect(r.created.map(c => c.dedupe_key)).toEqual(['new'])
    expect(r.resolved).toBe(3)
    expect(queryOne.mock.calls.filter(c => String(c[0]).startsWith('INSERT')).length).toBe(1)
    const resolve = query.mock.calls.find(c => String(c[0]).includes("status = 'resolved'"))!
    expect(resolve[1]).toEqual([['old', 'new']])
  })

  it('skips keys notified in the last 24 hours (flapping)', async () => {
    queryMany.mockResolvedValue([{ dedupe_key: 'flap' }])
    const out = await alertsToNotify([{ id: '5', dedupe_key: 'flap' } as any, { id: '6', dedupe_key: 'fresh' } as any])
    expect(out.map(a => a.dedupe_key)).toEqual(['fresh'])
  })

  it('sends one bell notification and one email per recipient for a batch, then marks them notified', async () => {
    queryOne.mockResolvedValue(null)
    queryMany.mockResolvedValue([
      { role: 'super_admin', scopes: [], email: 'Owner@Store.in' },
      { role: 'staff', scopes: ['google_ads:read'], email: 'ads@store.in' },
      { role: 'staff', scopes: ['orders:read'], email: 'ops@store.in' },
    ])
    const alerts = [
      { id: '7', dedupe_key: 'a', severity: 'warning', title: 'Spend spike', message: 'm' },
      { id: '8', dedupe_key: 'b', severity: 'critical', title: 'Tracking stopped', message: 'n' },
    ] as any
    const r = await notifyAlerts(alerts)
    expect(createAdminNotification).toHaveBeenCalledTimes(1)
    expect(createAdminNotification.mock.calls[0][0]).toMatchObject({
      severity: 'critical',
      category: 'marketing',
      scope: 'google_ads:read',
      title: '2 new Google Ads alerts',
      entityId: 'batch-7',
    })
    expect(sendAuditedMail.mock.calls.map(c => c[0].to).sort()).toEqual(['ads@store.in', 'owner@store.in'])
    expect(r.emailed).toBe(2)
    expect(query.mock.calls.at(-1)).toEqual([expect.stringContaining('SET notified_at = now()'), [['7', '8']]])
  })

  it('respects the alert email opt-out', async () => {
    queryOne.mockImplementation(async (_s: string, p: any[]) => (p?.[0] === 'google_ads_alert_emails' ? { value: 'false' } : null))
    await notifyAlerts([{ id: '1', dedupe_key: 'a', severity: 'info', title: 't', message: null } as any])
    expect(createAdminNotification).toHaveBeenCalledTimes(1)
    expect(sendAuditedMail).not.toHaveBeenCalled()
  })

  it('renders an escaped email with a link to the console', () => {
    const { subject, html } = renderAlertsEmail([{ title: '<b>x</b>', message: 'y', severity: 'warning' }], 'Acme', 'https://a/google-ads?tab=overview')
    expect(subject).toBe('Google Ads alert: <b>x</b>')
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(html).toContain('https://a/google-ads?tab=overview')
  })
})
