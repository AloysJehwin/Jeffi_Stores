import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), getClient: vi.fn() }))

import { mapReportRows, mapCampaign } from '@/lib/amazon-ads/sync'
import { kpis, budgetProblems, bidProblems, AadsActionSchema } from '@/lib/amazon-ads/console'
import { multiStatusErrors } from '@/lib/amazon-ads/client'
import { evaluateAads, AADS_DEFAULTS, type AadsSnapshot } from '@/lib/amazon-ads/alerts'

describe('Amazon Ads reports', () => {
  it('maps and merges campaign and search-term rows', () => {
    const c = mapReportRows('campaigns', [
      { date: '2026-10-10', campaignId: 1, impressions: 100, clicks: 5, cost: 50, sales7d: 200, purchases7d: 1, unitsSoldClicks7d: 1 },
      { date: '2026-10-10', campaignId: 1, impressions: 10, clicks: 1, cost: 5, sales7d: 0, purchases7d: 0, unitsSoldClicks7d: 0 },
    ])
    expect(c).toEqual([['2026-10-10', '1', 110, 6, 55, 200, 1, 1]])
    const t = mapReportRows('searchTerms', [{ date: '2026-10-10', campaignId: 1, adGroupId: 2, searchTerm: 'drill', clicks: 3, cost: 9 }, { date: '2026-10-10' }])
    expect(t).toEqual([['2026-10-10', '1', '2', '', 'drill', 0, 3, 9, 0, 0]])
  })
  it('maps campaigns', () => {
    expect(mapCampaign({ campaignId: 9, name: 'A', state: 'ENABLED', targetingType: 'MANUAL', budget: { budget: 500 } })).toEqual(['9', 'A', 'ENABLED', 'MANUAL', 500, null, null, null])
  })
})

describe('Amazon Ads console', () => {
  it('computes ACoS and ROAS', () => {
    expect(kpis({ cost: 50, sales: 200, clicks: 10, impressions: 1000, orders: 2 })).toMatchObject({ acos: 0.25, roas: 4, cpc: 5, ctr: 0.01 })
    expect(kpis({}).acos).toBeNull()
  })
  it('guards budgets and bids', () => {
    expect(budgetProblems(20, null)[0]).toMatch(/minimum daily budget/)
    expect(budgetProblems(600, 100)[0]).toMatch(/5x/)
    expect(budgetProblems(300, 100)).toEqual([])
    expect(bidProblems(0.5, null)[0]).toMatch(/minimum bid/)
    expect(bidProblems(30, 5)[0]).toMatch(/5x/)
  })
  it('reads multi-status errors', () => {
    expect(multiStatusErrors({ campaigns: { success: [], error: [{ index: 0, errors: [{ errorType: 'x', errorValue: { budget: { message: 'Budget too low' } } }] }] } }, 'campaigns')).toEqual(['Budget too low'])
    expect(multiStatusErrors({ campaigns: { success: [{}], error: [] } }, 'campaigns')).toEqual([])
  })
  it('rejects malformed actions', () => {
    expect(AadsActionSchema.safeParse({ action: 'campaign.state', campaignId: '12; drop', state: 'PAUSED' }).success).toBe(false)
    expect(AadsActionSchema.safeParse({ action: 'negative.add', campaignId: '1', adGroupId: '2', text: 'x', matchType: 'EXACT' }).success).toBe(false)
  })
})

describe('Amazon Ads alerts', () => {
  const base: AadsSnapshot = { campaigns: [], noSales: [], wasted: [], outOfStock: [], lastReportAt: '2026-10-16T00:00:00Z' }
  const keys = (s: Partial<AadsSnapshot>) => evaluateAads({ ...base, ...s }, AADS_DEFAULTS, new Date('2026-10-16T10:00:00Z')).map(f => f.key)
  it('flags high ACoS, spend without sales, wasted terms, out-of-stock ads and stale reports', () => {
    expect(
      keys({
        campaigns: [{ campaignId: '1', name: 'A', cost: 1000, sales: 1500 }, { campaignId: '2', name: 'B', cost: 1000, sales: 5000 }],
        noSales: [{ campaignId: '3', name: 'C', cost: 800 }, { campaignId: '4', name: 'D', cost: 100 }],
        wasted: [{ term: 'x', campaign: 'A', clicks: 30, cost: 200 }, { term: 'y', campaign: 'A', clicks: 2, cost: 5 }],
        outOfStock: [{ sku: 'S', name: 'Saw', cost: 50 }],
      })
    ).toEqual(['acos_target:1', 'spend_no_sales:3', 'wasted_terms:1', 'ads_out_of_stock:S'])
    expect(keys({ lastReportAt: '2026-10-14T00:00:00Z' })).toEqual(['reports_stale'])
  })
})
