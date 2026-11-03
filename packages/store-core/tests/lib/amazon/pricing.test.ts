import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), getClient: vi.fn() }))

import { mapItemOffers, mapFeeResult, submissionProblems } from '@/lib/amazon/pricing-api'
import { marginFloor, propose, ruleFor, marginAt, type RepricerRule } from '@/lib/amazon/repricer'
import { evaluateAmazon, AMAZON_DEFAULTS, type AmazonAlertSnapshot } from '@/lib/amazon/alerts'

const money = (a: number) => ({ CurrencyCode: 'INR', Amount: a })

describe('offers and fees parsing', () => {
  it('finds the Buy Box and whether it is ours', () => {
    const payload = {
      ASIN: 'B01',
      Summary: { TotalOfferCount: 3, BuyBoxPrices: [{ condition: 'New', LandedPrice: money(990) }], LowestPrices: [{ condition: 'new', fulfillmentChannel: 'Merchant', LandedPrice: money(950) }, { condition: 'new', fulfillmentChannel: 'Amazon', LandedPrice: money(1000) }] },
      Offers: [
        { SellerId: 'ME', MyOffer: true, ListingPrice: money(1040), Shipping: money(0), IsBuyBoxWinner: false },
        { SellerId: 'X', ListingPrice: money(990), Shipping: money(0), IsBuyBoxWinner: true, IsFulfilledByAmazon: true },
      ],
    }
    expect(mapItemOffers(payload, 'ME')).toEqual({
      asin: 'B01',
      ourPrice: 1040,
      buyboxPrice: 990,
      buyboxIsOurs: false,
      buyboxFba: true,
      lowestPrice: 950,
      lowestFbaPrice: 1000,
      offerCount: 3,
      buyboxEligible: null,
    })
    expect(mapItemOffers({}, 'ME')).toBeNull()
  })

  it('groups fees and adds 18% GST unless Amazon sent the tax', () => {
    const res = (details: any[]) => ({
      FeesEstimateResult: {
        Status: 'Success',
        FeesEstimateIdentifier: { IdValue: 'SKU1' },
        FeesEstimate: { FeeDetailList: details.map(([t, a]) => ({ FeeType: t, FinalFee: money(a) })) },
      },
    })
    expect(mapFeeResult(res([['ReferralFee', 80], ['FixedClosingFee', 20], ['FBAWeightHandlingFee', 50]]), 1000)).toMatchObject({
      sku: 'SKU1',
      referral: 80,
      closing: 20,
      fulfillment: 50,
      other: 0,
      total: 150,
      gstOnFees: 27,
    })
    expect(mapFeeResult(res([['ReferralFee', 80], ['TaxAmount', 14.4]]), 1000)).toMatchObject({ total: 80, gstOnFees: 14.4 })
    expect(mapFeeResult({ FeesEstimateResult: { Status: 'ClientError' } }, 1)).toBeNull()
  })

  it('reads Amazon submission problems', () => {
    expect(submissionProblems({ status: 'VALID', issues: [{ severity: 'WARNING', message: 'w' }] })).toEqual([])
    expect(submissionProblems({ status: 'INVALID', issues: [{ severity: 'ERROR', message: 'Price too low' }] })).toEqual(['Price too low'])
  })
})

describe('repricer', () => {
  const rule = (o: Partial<RepricerRule> = {}): RepricerRule => ({ id: '1', sku: null, strategy: 'match_buybox', beatBy: 0, minPrice: null, maxPrice: null, minMarginPct: 10, autoApply: false, enabled: true, ...o })
  const input = { sku: 'A', price: 1100, exRatio: 1 / 1.18, cost: 600, buyboxPrice: 1000, buyboxIsOurs: false, referralRate: 0.08, fixedFees: 40 }

  it('computes the floor that keeps the margin after fees and cost', () => {
    const f = marginFloor(input, 10)!
    expect(marginAt(f, input)! - 0.1 * f * input.exRatio).toBeGreaterThanOrEqual(-0.01)
    expect(marginFloor({ ...input, cost: null }, 10)).toBeNull()
  })

  it('matches or beats the Buy Box but never below the floor or above the max', () => {
    expect(propose(input, rule())).toMatchObject({ target: 1000 })
    expect(propose(input, rule({ strategy: 'beat_buybox', beatBy: 5 }))).toMatchObject({ target: 995 })
    const floor = marginFloor(input, 30)!
    expect(propose(input, rule({ minMarginPct: 30 }))).toMatchObject({ target: floor, reason: expect.stringContaining('floor') })
    expect(propose({ ...input, buyboxPrice: 1500 }, rule({ maxPrice: 1200 }))).toMatchObject({ target: 1200 })
  })

  it('does nothing when we own the Buy Box, on hold, or for a tiny change', () => {
    expect(propose({ ...input, buyboxIsOurs: true }, rule())).toBeNull()
    expect(propose(input, rule({ strategy: 'hold' }))).toBeNull()
    expect(propose({ ...input, buyboxPrice: 1100.2 }, rule())).toBeNull()
  })

  it('prefers the SKU rule over the default and skips disabled rules', () => {
    const rules = [rule({ id: 'd' }), rule({ id: 's', sku: 'A' })]
    expect(ruleFor(rules, 'A')?.id).toBe('s')
    expect(ruleFor(rules, 'B')?.id).toBe('d')
    expect(ruleFor([rule({ enabled: false })], 'B')).toBeNull()
  })
})

describe('Amazon alerts', () => {
  const base: AmazonAlertSnapshot = { suppressed: [], buyboxLost: [], margins: [], lastPush: null, lastOrderImport: null, stockDrift: [] }
  const keys = (s: Partial<AmazonAlertSnapshot>, now = new Date('2026-10-16T12:00:00Z')) => evaluateAmazon({ ...base, ...s }, AMAZON_DEFAULTS, now).map(f => f.key)

  it('covers suppressed, lost Buy Box, loss-making and below-floor prices', () => {
    expect(
      keys({
        suppressed: [{ sku: 'a', title: 'A' }],
        buyboxLost: [{ sku: 'b', title: 'B', ours: 10, buybox: 9, offers: 3 }, { sku: 'c', title: 'C', ours: 10, buybox: 9, offers: 1 }],
        margins: [{ sku: 'd', title: 'D', price: 100, margin: -5, floor: 120 }, { sku: 'e', title: 'E', price: 100, margin: 3, floor: 110 }],
      })
    ).toEqual(['suppressed:1', 'buybox_lost:b', 'negative_margin:d', 'below_floor:e'])
  })
  it('flags a stalled order import and stock drift', () => {
    expect(keys({ lastOrderImport: { status: 'success', finishedAt: '2026-10-16T00:00:00Z' }, stockDrift: [{ sku: 'x', ours: 5, amazon: 9 }, { sku: 'y', ours: 5, amazon: 6 }] })).toEqual([
      'orders_stalled',
      'stock_drift:1',
    ])
    expect(keys({ lastOrderImport: { status: 'success', finishedAt: '2026-10-16T10:00:00Z' } })).toEqual([])
  })
})
