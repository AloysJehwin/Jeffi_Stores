import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), getClient: vi.fn() }))

import { mapPerformance, mapPriceInsights, mapBestSellers, lastWeekStart } from '@/lib/merchant/reports'
import { evaluateGmc, GMC_DEFAULTS, type GmcAlertSnapshot } from '@/lib/merchant/alerts'
import { isValidGtin, priceProblems, exGstFor, applyServices, ActionSchema } from '@/lib/merchant/actions'
import { marginAt } from '@/lib/merchant/console-data'

describe('report mapping', () => {
  it('maps performance rows and merges duplicates per day, offer and method', () => {
    const row = (clicks: string) => ({
      productPerformanceView: { date: { year: 2026, month: 10, day: 5 }, offerId: 'SKU-1', marketingMethod: 'ORGANIC', title: 'Drill', clicks, impressions: '10', conversions: 1, conversionValue: { amountMicros: '2500000000' } },
    })
    expect(mapPerformance([row('3'), row('2')])).toEqual([['2026-10-05', 'SKU-1', 'ORGANIC', 'Drill', 5, 20, 2, 5000]])
    expect(mapPerformance([{ productPerformanceView: { offerId: 'x' } }])).toEqual([])
  })

  it('maps price insights with micros', () => {
    const r = mapPriceInsights([{ priceInsightsProductView: { offerId: 'a', price: { amountMicros: '1000000000' }, suggestedPrice: { amountMicros: '900000000' }, predictedConversionsChangeFraction: 0.2, effectiveness: 'HIGH' } }])
    expect(r[0]).toEqual(['a', null, null, 1000, 900, null, null, 0.2, 'HIGH'])
  })

  it('matches best sellers to the catalogue by GTIN', () => {
    const bs = (rank: number, gtins: string[]) => ({ bestSellersProductClusterView: { reportDate: { year: 2026, month: 10, day: 5 }, reportCategoryId: '632', rank, title: `T${rank}`, variantGtins: gtins } })
    const byGtin = new Map([
      ['8901234567890', { productId: 'p1', offerId: 'SKU-1', inStock: true }],
      ['8901234567891', { productId: 'p2', offerId: 'SKU-2', inStock: false }],
      ['8901234567892', { productId: 'p3', offerId: 'SKU-3', inStock: true }],
    ])
    const listed = new Set(['sku-1', 'sku-2'])
    const rows = mapBestSellers([bs(1, ['08901234567890']), bs(2, ['8901234567891']), bs(3, ['8901234567892']), bs(4, ['1']), bs(4, ['1'])], byGtin, listed)
    expect(rows.map(r => [r[2], r[13], r[14]])).toEqual([
      [1, 'p1', 'in_stock'],
      [2, 'p2', 'out_of_stock'],
      [3, 'p3', 'not_listed'],
      [4, null, 'not_carried'],
    ])
  })

  it('picks the Monday of the last complete week in India time', () => {
    expect(lastWeekStart(new Date('2026-10-16T10:00:00Z'))).toBe('2026-10-05')
    expect(lastWeekStart(new Date('2026-10-18T20:00:00Z'))).toBe('2026-10-12')
  })
})

describe('Merchant alerts', () => {
  const base: GmcAlertSnapshot = { status: { total: 100, disapproved: 2 }, accountIssues: [], overpriced: [], notListed: [], lastSync: { status: 'success', finishedAt: 'x', errors: 0 } }
  const keys = (s: Partial<GmcAlertSnapshot>, cfg = GMC_DEFAULTS) => evaluateGmc({ ...base, ...s }, cfg).map(f => f.key)

  it('flags a disapproved share over the threshold, critical over 30%', () => {
    expect(keys({})).toEqual([])
    const f = evaluateGmc({ ...base, status: { total: 100, disapproved: 40 } }, GMC_DEFAULTS)
    expect(f[0]).toMatchObject({ key: 'disapproved_share', severity: 'critical' })
    expect(keys({ status: { total: 5, disapproved: 5 } })).toEqual([])
  })
  it('account issues, overpriced products with clicks, unlisted best sellers, failed push', () => {
    expect(
      keys({
        accountIssues: [{ name: 'i1', title: 'Misrepresentation', severity: 'CRITICAL' }, { name: 'i2', title: 'Tip', severity: 'SUGGESTION' }],
        overpriced: [{ offerId: 'a', title: 'A', price: 120, benchmark: 100, clicks: 50 }, { offerId: 'b', title: 'B', price: 120, benchmark: 100, clicks: 1 }],
        notListed: [{ title: 'X', rank: 3, category: null }],
        lastSync: { status: 'error', finishedAt: 't', errors: 2 },
      })
    ).toEqual(['account_issue:i1', 'uncompetitive_price:a', 'best_seller_not_listed:1', 'sync_failed:t'])
  })
})

describe('Merchant actions', () => {
  it('validates GTIN check digits', () => {
    expect(isValidGtin('4006381333931')).toBe(true)
    expect(isValidGtin('4006381333932')).toBe(false)
    expect(isValidGtin('12345')).toBe(false)
  })
  it('keeps the GST ratio and guards price changes', () => {
    expect(exGstFor(1180, 1000, 847.46)).toBe(1000)
    expect(priceProblems(400, 1000, 0.8475, 300, false)).toEqual(['That is more than a 50% change from the current price; change it on the product page instead.'])
    expect(priceProblems(900, 1000, 0.8475, 800, false)[0]).toMatch(/below your cost/)
    expect(priceProblems(900, 1000, 0.8475, 800, true)).toEqual([])
    expect(marginAt(1180, 1180, 1000, 700)).toBe(300)
  })
  it('keeps Google rate tables on existing services and adds flat-rate services', () => {
    const current = { etag: 'e', services: [{ serviceName: 'Std', deliveryCountries: ['IN'], rateGroups: [{ mainTable: { x: 1 } }], deliveryTime: { cutoffTime: { hour: 14 } } }] }
    const next = applyServices(current, [
      { name: 'Std', flatRate: 0, minHandlingDays: 0, maxHandlingDays: 1, minTransitDays: 2, maxTransitDays: 4, active: true },
      { name: 'Express', flatRate: 99, minHandlingDays: 0, maxHandlingDays: 0, minTransitDays: 1, maxTransitDays: 2, active: true },
    ])
    expect(next.etag).toBe('e')
    expect(next.services[0].deliveryTime).toMatchObject({ cutoffTime: { hour: 14 }, maxTransitDays: 4 })
    expect(next.services[0].rateGroups).toEqual([{ mainTable: { x: 1 } }])
    const flat = applyServices({ services: [{ serviceName: 'Std', rateGroups: [{ singleValue: { flatRate: { amountMicros: '50000000' } } }] }] }, [
      { name: 'Std', flatRate: 70, minHandlingDays: 0, maxHandlingDays: 1, minTransitDays: 2, maxTransitDays: 4, active: true },
    ])
    expect(flat.services[0].rateGroups).toEqual([{ singleValue: { flatRate: { amountMicros: '70000000', currencyCode: 'INR' } } }])
    expect(next.services[1]).toMatchObject({ serviceName: 'Express', deliveryCountries: ['IN'], rateGroups: [{ singleValue: { flatRate: { amountMicros: '99000000' } } }] })
  })
  it('rejects malformed actions at the schema', () => {
    expect(ActionSchema.safeParse({ action: 'product.price', offerId: 'a', price: -1 }).success).toBe(false)
    expect(ActionSchema.safeParse({ action: 'returns.delete', name: '../x' }).success).toBe(false)
    expect(ActionSchema.safeParse({ action: 'promotion.create', promotionId: 'bad id', title: 't', kind: 'PERCENT_OFF', value: 10, start: '2026-10-16T00:00:00Z', end: '2026-10-20T00:00:00Z' }).success).toBe(false)
  })
})
