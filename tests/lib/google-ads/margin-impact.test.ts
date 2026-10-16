import { describe, it, expect, vi, beforeEach } from 'vitest'

const { queryOne, queryMany } = vi.hoisted(() => ({ queryOne: vi.fn(), queryMany: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne, queryMany }))
vi.mock('@/lib/google-ads/attribution', async () => {
  const actual = await vi.importActual<any>('@/lib/google-ads/attribution')
  return { ...actual, googleAdsOrderStats: vi.fn(async () => ({ available: true, orders: 10, revenue: 20000, refunds: 0, tax: 2000, cogs: 12000 })) }
})

import { loadEconomics, marginImpact, withMarginImpact, type Economics } from '@/lib/google-ads/margin-impact'
import { googleAdsOrderStats } from '@/lib/google-ads/attribution'

const econ: Economics = { aov: 2000, marginRate: 0.3, basis: 'ads_orders' }

beforeEach(() => {
  vi.clearAllMocks()
  queryOne.mockResolvedValue(null)
  queryMany.mockResolvedValue([])
})

describe('marginImpact', () => {
  it('values extra conversions at the order value and margin, less the extra spend', () => {
    // 5 x 2000 x 0.3 = 3000 profit, 1200 extra cost
    expect(marginImpact({ type: 'CAMPAIGN_BUDGET', extraConversions: 5, extraCost: 1200 }, econ)).toMatchObject({ profitImpact: 1800, verdict: 'gain' })
    expect(marginImpact({ type: 'CAMPAIGN_BUDGET', extraConversions: 1, extraCost: 1200 }, econ)).toMatchObject({ profitImpact: -600, verdict: 'loss' })
  })

  it('falls back to extra conversion value, and says when cost prices are missing', () => {
    expect(marginImpact({ type: 'KEYWORD', extraConversions: null, extraCost: 100, extraValue: 1000 }, econ).profitImpact).toBe(200)
    const none = marginImpact({ type: 'KEYWORD', extraConversions: 3, extraCost: 10 }, { aov: 500, marginRate: null, basis: 'all_orders' })
    expect(none).toMatchObject({ profitImpact: null, verdict: null, note: 'Add cost prices to products to see the profit effect.' })
  })

  it('gives break-even ROAS and CPA for bid-target recommendations', () => {
    const roas = marginImpact({ type: 'TARGET_ROAS_OPT_IN', extraConversions: null, extraCost: null }, econ)
    expect(roas.breakEvenRoas).toBe(3.33)
    expect(roas.note).toContain('Break-even ROAS at your margin is 3.33x')
    expect(marginImpact({ type: 'TARGET_CPA_OPT_IN', extraConversions: null, extraCost: null }, econ).note).toContain('600')
  })

  it('flags spend-increasing recommendations on campaigns spending on out-of-stock items', () => {
    expect(marginImpact({ type: 'CAMPAIGN_BUDGET', extraConversions: 1, extraCost: 1 }, econ, 0.4).stockConflict).toMatch(/40% of this campaign's product spend/)
    expect(marginImpact({ type: 'CAMPAIGN_BUDGET', extraConversions: 1, extraCost: 1 }, econ, 0.1).stockConflict).toBeNull()
    expect(marginImpact({ type: 'CALLOUT_ASSET', extraConversions: 1, extraCost: 1 }, econ, 0.9).stockConflict).toBeNull()
  })
})

describe('economics', () => {
  it("uses Google-attributed orders: net revenue per order and gross profit share", async () => {
    // revenue 20000, tax 2000, cogs 12000 -> profit 6000 / 20000
    expect(await loadEconomics()).toEqual({ aov: 2000, marginRate: 0.3, basis: 'ads_orders' })
  })

  it('falls back to all paid orders and refuses a margin when most sales have no cost price', async () => {
    vi.mocked(googleAdsOrderStats).mockResolvedValueOnce({ available: true, orders: 1, revenue: 1, refunds: 0, tax: 0, cogs: 0 })
    queryOne.mockImplementation(async (sql: string) => (sql.includes('WITH o AS') ? { orders: 4, revenue: '4000', tax: '400', cogs: '2000', costed: '0.1' } : null))
    expect(await loadEconomics()).toEqual({ aov: 1000, marginRate: null, basis: 'all_orders' })
  })

  it('adds margin and stock data to recommendation rows', async () => {
    queryMany.mockResolvedValue([{ campaign_id: '5', total: '1000', oos: '600' }])
    const [row] = await withMarginImpact([{ type: 'CAMPAIGN_BUDGET', extraConversions: 2, extraCost: 100, campaignId: '5' }])
    expect(row.margin.profitImpact).toBe(1100)
    expect(row.margin.stockConflict).toMatch(/60%/)
    expect(row.economics.basis).toBe('ads_orders')
  })
})
