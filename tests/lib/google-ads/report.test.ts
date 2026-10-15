import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(), queryMany: vi.fn() }))
vi.mock('@/lib/google-ads/attribution', async () => {
  const actual = await vi.importActual<any>('@/lib/google-ads/attribution')
  return {
    ...actual,
    googleAdsOrderStats: vi.fn(async () => ({ available: true, orders: 2, revenue: 3000, refunds: 0, tax: 0, cogs: 1000 })),
  }
})

import {
  parseRange,
  previousRange,
  kpisFrom,
  productFlags,
  loadTab,
  loadOverview,
  loadCampaigns,
  loadProducts,
  loadKeywords,
} from '@/lib/google-ads/report'
import { queryOne, queryMany } from '@/lib/shared/db'
import { googleAdsOrderStats } from '@/lib/google-ads/attribution'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(queryMany).mockResolvedValue([])
  vi.mocked(queryOne).mockResolvedValue(null)
})

describe('ranges', () => {
  const today = new Date('2026-10-16T08:00:00Z')
  it('defaults to the last 30 days', () => {
    expect(parseRange(null, null, today)).toEqual({ from: '2026-09-17', to: '2026-10-16' })
  })
  it('swaps reversed dates and ignores garbage', () => {
    expect(parseRange('2026-10-10', '2026-10-01', today)).toEqual({ from: '2026-10-01', to: '2026-10-10' })
    expect(parseRange("1'; drop", '2026-10-16', today)).toEqual({ from: '2026-09-17', to: '2026-10-16' })
  })
  it('clamps very long ranges', () => {
    expect(parseRange('2020-01-01', '2026-10-16', today).from).toBe('2025-09-11')
  })
  it('compares with the equally long period before', () => {
    expect(previousRange({ from: '2026-10-01', to: '2026-10-10' })).toEqual({ from: '2026-09-21', to: '2026-09-30' })
    expect(previousRange({ from: '2026-10-16', to: '2026-10-16' })).toEqual({ from: '2026-10-15', to: '2026-10-15' })
  })
})

describe('kpisFrom', () => {
  it('converts micros to rupees and derives ratios', () => {
    const k = kpisFrom({ cost_micros: '5000000000', impressions: '10000', clicks: '250', conversions: '10', conversions_value: '20000' })
    expect(k).toMatchObject({ cost: 5000, ctr: 0.025, avgCpc: 20, roas: 4, costPerConversion: 500 })
  })
  it('leaves ratios empty without a denominator', () => {
    expect(kpisFrom({})).toMatchObject({ cost: 0, ctr: null, avgCpc: null, roas: null, costPerConversion: null })
  })
})

describe('productFlags', () => {
  const base = { sku: 'A1', stock: 5, stockStatus: 'In Stock', unitMargin: 100, cost: 50, conversions: 1 }
  it('flags spend on out-of-stock items by stock status', () => {
    expect(productFlags({ ...base, stockStatus: 'Out of Stock' })).toContain('out_of_stock')
    expect(productFlags({ ...base, stock: 0 })).not.toContain('out_of_stock')
    expect(productFlags({ ...base, stockStatus: null, stock: 0 })).toContain('out_of_stock')
    expect(productFlags({ ...base, stockStatus: 'Out of Stock', cost: 0 })).not.toContain('out_of_stock')
  })
  it('flags items sold at a loss and ads costing more than the margin earned', () => {
    expect(productFlags({ ...base, unitMargin: -5 })).toEqual(['negative_margin'])
    expect(productFlags({ ...base, unitMargin: 40, conversions: 1, cost: 50 })).toEqual(['unprofitable'])
    expect(productFlags(base)).toEqual([])
  })
  it('marks items with no matching SKU', () => {
    expect(productFlags({ ...base, sku: null })).toEqual(['unmatched'])
  })
})

describe('loaders', () => {
  it('builds the overview with period compare and true ROAS', async () => {
    vi.mocked(queryOne).mockImplementation(async (sql: string, params?: any[]) => {
      if (sql.includes('FROM ads_account')) return { time_zone: 'Asia/Kolkata', optimization_score: '0.81' } as any
      if (sql.includes('FROM ads_daily_metrics') && params?.[0] === '2026-10-01')
        return { cost_micros: '1000000000', impressions: '1000', clicks: '50', conversions: '5', conversions_value: '4000' } as any
      if (sql.includes('FROM ads_daily_metrics')) return { cost_micros: '500000000', impressions: '800', clicks: '25', conversions: '2', conversions_value: '1000' } as any
      if (sql.includes('FROM ads_ads')) return { issues: 3, disapproved: 1 } as any
      return null
    })
    const d = await loadOverview({ from: '2026-10-01', to: '2026-10-10' })
    expect(d.kpis.cost).toBe(1000)
    expect(d.previousKpis.cost).toBe(500)
    expect(d.previous).toEqual({ from: '2026-09-21', to: '2026-09-30' })
    expect(d.policyIssues).toBe(3)
    expect(d.disapproved).toBe(1)
    expect(d.returns.trueRoas).toBe(3)
    expect(d.returns.poas).toBe(2)
    expect(googleAdsOrderStats).toHaveBeenCalledWith({ from: '2026-10-01', to: '2026-10-10' }, 'Asia/Kolkata')
  })

  it('maps campaign rows with budget in rupees', async () => {
    vi.mocked(queryMany).mockResolvedValue([
      { campaign_id: '11', name: 'Search', status: 'ENABLED', channel_type: 'SEARCH', budget_amount_micros: '500000000', budget_period: 'DAILY', cost_micros: '2500000', clicks: '5' },
    ])
    const [c] = await loadCampaigns({ from: '2026-10-01', to: '2026-10-10' })
    expect(c).toMatchObject({ campaignId: '11', budget: 500, cost: 2.5, clicks: 5, avgCpc: 0.5 })
    expect(vi.mocked(queryMany).mock.calls[0][0]).toMatch(/m\.ad_group_id = 0/)
  })

  it('joins shopping items to SKUs and computes margin', async () => {
    vi.mocked(queryMany)
      .mockResolvedValueOnce([
        { item_id: 'sku-1', title: 'Pump', sku: 'SKU-1', product_name: 'Pump', stock: '0', stock_status: 'Out of Stock', price: '1000', cost_price: '1100', cost_micros: '300000000', conversions: '1' },
        { item_id: 'gone', title: 'Old', sku: null, cost_micros: '1000000' },
      ])
      .mockResolvedValueOnce([{ sku: 'SKU-9', name: 'Drill', units: '12', revenue: '24000' }])
    const d = await loadProducts({ from: '2026-10-01', to: '2026-10-10' })
    expect(d.items[0]).toMatchObject({ sku: 'SKU-1', unitMargin: -100, cost: 300 })
    expect(d.items[0].flags).toEqual(['out_of_stock', 'negative_margin'])
    expect(d.items[1].flags).toEqual(['unmatched'])
    expect(d.bestsellersWithoutImpressions).toEqual([{ sku: 'SKU-9', name: 'Drill', units: 12, revenue: 24000 }])
    expect(vi.mocked(queryMany).mock.calls[0][0]).toMatch(/regexp_replace\(v\.sku/)
  })

  it('flags search terms outside the catalogue', async () => {
    vi.mocked(queryMany)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { search_term: 'grease pump', in_catalogue: true, cost_micros: '1000000' },
        { search_term: 'free movies', in_catalogue: false, cost_micros: '2000000' },
      ])
    const d = await loadKeywords({ from: '2026-10-01', to: '2026-10-10' })
    expect(d.searchTerms.map(t => [t.term, t.inCatalogue])).toEqual([
      ['grease pump', true],
      ['free movies', false],
    ])
    const sql = String(vi.mocked(queryMany).mock.calls[1][0])
    expect(sql).toMatch(/FROM products p/)
    expect(sql).toMatch(/FROM categories c/)
    expect(sql).toMatch(/FROM search_logs s/)
  })

  it('dispatches every tab', async () => {
    for (const tab of ['campaigns', 'adgroups', 'keywords', 'products', 'locations', 'recommendations', 'changes', 'sync'] as const) {
      await expect(loadTab(tab, { from: '2026-10-01', to: '2026-10-10' })).resolves.toBeTruthy()
    }
  })
})
