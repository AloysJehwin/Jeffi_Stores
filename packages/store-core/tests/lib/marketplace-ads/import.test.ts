import { describe, it, expect, vi, beforeEach } from 'vitest'

// An in-memory marketplace_ad_daily / marketplace_ad_imports store driven through the real commit.
const state = vi.hoisted(() => ({ daily: [] as Record<string, unknown>[], imports: [] as unknown[][], changes: [] as unknown[][] }))

vi.mock('@/lib/shared/db', () => {
  const PK = (r: Record<string, unknown>) => `${r.channel}|${r.date}|${r.campaign_key}|${r.ad_group}`
  const run = async (sql: string, p: any[] = []) => {
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }] }
    if (sql.startsWith('INSERT INTO channel_sync_log')) return { rows: [{ id: '1' }] }
    if (sql.startsWith('INSERT INTO channel_change_log')) {
      state.changes.push(p)
      return { rows: [{ id: String(state.changes.length) }] }
    }
    if (sql.startsWith('DELETE FROM marketplace_ad_daily')) {
      const keep = state.daily.filter(r => !(r.channel === p[0] && String(r.date) >= p[1] && String(r.date) <= p[2]))
      const n = state.daily.length - keep.length
      state.daily = keep
      return { rows: [], rowCount: n }
    }
    if (sql.startsWith('INSERT INTO marketplace_ad_imports')) {
      state.imports.push(p)
      return { rows: [{ id: `imp-${state.imports.length}` }] }
    }
    if (sql.startsWith('INSERT INTO marketplace_ad_daily')) {
      const cols = /\(([^)]+)\) VALUES/.exec(sql)![1].split(',')
      for (let i = 0; i < p.length; i += cols.length) {
        const row = Object.fromEntries(cols.map((c, j) => [c, p[i + j]]))
        if (state.daily.some(r => PK(r) === PK(row))) throw new Error('duplicate key value violates unique constraint "marketplace_ad_daily_pkey"')
        state.daily.push(row)
      }
      return { rows: [], rowCount: p.length / cols.length }
    }
    if (sql.includes('FROM marketplace_ad_daily') && sql.includes('count(*)')) return { rows: [{ n: String(state.daily.filter(r => r.channel === p[0]).length) }] }
    return { rows: [] }
  }
  const client = { query: vi.fn(run), release: vi.fn() }
  return {
    query: vi.fn(run),
    queryOne: vi.fn(async (sql: string, p?: any[]) => (await run(sql, p)).rows[0] ?? null),
    queryMany: vi.fn(async (sql: string, p?: any[]) => (await run(sql, p)).rows),
    getClient: vi.fn(async () => client),
  }
})
vi.mock('@/lib/channels/alerts-engine', () => ({ runChannelAlerts: vi.fn(async () => ({ findings: 0, created: 0, resolved: 0, notified: 0 })) }))

import { commitImport, previewImport } from '@/lib/marketplace-ads/import'

const actor = { adminId: '11111111-1111-4111-8111-111111111111', email: 'ads@crm.test' }
const csv = (body: string) => Buffer.from(`Myntra Ads campaign report,,,,,,,,\n${body}`)
const REPORT = csv(
  [
    'Date,Campaign Name,Campaign ID,Impressions,Clicks,Spend (₹),Orders,Units Sold,Revenue (₹)',
    '05-10-2026,Diwali Tees,C1,"12,000",300,"₹1,500.50",6,7,"₹4,200"',
    '05-10-2026,Diwali Tees,C1,1000,20,100,0,0,0',
    '06-10-2026,Kurta Push,C2,8000,150,900,2,2,1800',
    'Total,,,21000,470,2500.50,8,9,6000',
  ].join('\n')
)

describe('marketplace ads import', () => {
  beforeEach(() => {
    state.daily = []
    state.imports = []
    state.changes = []
  })

  it('previews mapped rows, skipping the total row', async () => {
    const pv = await previewImport({ market: 'myntra', buf: REPORT, fileName: 'campaigns.csv' })
    expect(pv.headerRow).toBe(2)
    expect(pv.kind).toBe('campaign')
    expect(pv.problems).toEqual([])
    expect(pv.rowCount).toBe(3)
    expect(pv.skipped).toBe(1)
    expect(pv.range).toEqual({ from: '2026-10-05', to: '2026-10-06' })
    expect(pv.totals.cost).toBeCloseTo(2500.5)
    expect(pv.rows[0]).toMatchObject({ date: '2026-10-05', campaignKey: 'C1', impressions: 12000, spend: 1500.5, sales: 4200 })
  })

  it('re-importing the same report replaces its period and leaves no duplicates', async () => {
    const first = await commitImport({ market: 'myntra', buf: REPORT, fileName: 'campaigns.csv' }, actor)
    expect(first.ok).toBe(true)
    expect(first.result).toMatchObject({ rows: 2, replaced: 0, range: { from: '2026-10-05', to: '2026-10-06' } })
    expect(state.daily).toHaveLength(2)
    expect(state.daily.find(r => r.campaign_key === 'C1')).toMatchObject({ spend: 1600.5, impressions: 13000, clicks: 320 })

    const again = await commitImport({ market: 'myntra', buf: REPORT, fileName: 'campaigns.csv' }, actor)
    expect(again.ok).toBe(true)
    expect(again.result).toMatchObject({ rows: 2, replaced: 2 })
    expect(state.daily).toHaveLength(2)
    expect(state.daily.reduce((s, r) => s + Number(r.spend), 0)).toBeCloseTo(2500.5)
    expect(state.imports).toHaveLength(2)
  })

  it('refuses rows with problems unless told to leave them out', async () => {
    const bad = csv(['Date,Campaign,Spend', '05-10-2026,A,100', '06-10-2026,B,lots', 'someday,C,10'].join('\n'))
    const refused = await commitImport({ market: 'myntra', buf: bad, fileName: 'bad.csv' }, actor)
    expect(refused.ok).toBe(false)
    expect(refused.problems[0]).toMatch(/2 rows have problems/)
    expect(state.daily).toHaveLength(0)
    const partial = await commitImport({ market: 'myntra', buf: bad, fileName: 'bad.csv', allowErrors: true }, actor)
    expect(partial.ok).toBe(true)
    expect(state.daily).toHaveLength(1)
  })
})
