import { describe, it, expect, vi, beforeEach } from 'vitest'

const catalog = vi.hoisted(() => ({ getCatalog: vi.fn(), computePlans: vi.fn(), DEFAULT_SETTINGS: { gstRate: 0.18 } }))
const pricing = vi.hoisted(() => ({
  quoteSpec: vi.fn(),
  pausedInrHour: vi.fn(),
  monthlyTotal: (q: { inrMonth: number }, fee: number, gst: number) => ({ total: Math.round(fee + q.inrMonth * (1 + gst)) }),
}))
vi.mock('@controller/lib/compute/catalog', () => catalog)
vi.mock('@controller/lib/compute/pricing', () => pricing)

import { costsFor, istMonthStart, storeCost } from '@controller/lib/ecom/cost'

const CAT = { prices: [], settings: { gstRate: 0.18 } } as any
const SPEC = { node: { placement: 'dedicated', type: 't4g.medium', count: 1 }, db: { mode: 'node', storageGb: 20 } } as any
const QUOTE = { inrHour: 2, inrMonth: 1460, awsInrMonth: 1168, marginInrMonth: 292 }

beforeEach(() => {
  vi.clearAllMocks()
  pricing.quoteSpec.mockReturnValue(QUOTE)
  pricing.pausedInrHour.mockReturnValue(0.5)
})

describe('istMonthStart', () => {
  it('is midnight of the 1st in India', () => {
    expect(istMonthStart(new Date('2026-11-03T10:00:00Z')).toISOString()).toBe('2026-10-31T18:30:00.000Z')
    // 31 Oct 20:00 UTC is already 1 Nov in India.
    expect(istMonthStart(new Date('2026-10-31T20:00:00Z')).toISOString()).toBe('2026-10-31T18:30:00.000Z')
  })
})

describe('storeCost', () => {
  const now = new Date('2026-11-03T18:30:00Z') // 72 h into the IST month
  it('is all null without a spec or when the quote fails', () => {
    expect(storeCost({ spec: null, plan: null, appliedAt: null, status: null, catalog: CAT })).toMatchObject({ priceMonth: null, mtdEstimate: null })
    pricing.quoteSpec.mockImplementation(() => {
      throw new Error('no price')
    })
    expect(storeCost({ spec: SPEC, plan: null, appliedAt: null, status: null, catalog: CAT }).awsMonth).toBeNull()
  })

  it('prices at the plan margin and estimates the month so far', () => {
    const c = storeCost({ spec: SPEC, plan: { monthlyPriceInr: 1180, infraMargin: 0.25 }, appliedAt: '2026-10-01T00:00:00Z', status: 'applied', catalog: CAT, now })
    expect(pricing.quoteSpec).toHaveBeenCalledWith(SPEC, CAT, { infraMargin: 0.25 })
    expect(c).toEqual({ priceMonth: 2903, priceHour: 2, awsMonth: 1168, marginMonth: 1292, mtdEstimate: 144 })
  })

  it('uses the paused rate and counts from when compute was applied', () => {
    const c = storeCost({ spec: SPEC, plan: null, appliedAt: '2026-11-03T08:30:00Z', status: 'paused', catalog: CAT, now })
    expect(pricing.quoteSpec).toHaveBeenCalledWith(SPEC, CAT, undefined)
    expect(c.mtdEstimate).toBe(5)
    pricing.pausedInrHour.mockImplementation(() => {
      throw new Error('no price')
    })
    expect(storeCost({ spec: SPEC, plan: null, appliedAt: '2026-11-03T08:30:00Z', status: 'paused', catalog: CAT, now }).mtdEstimate).toBeNull()
  })
})

describe('costsFor', () => {
  it('reads the catalog and plans once and keys by tenant', async () => {
    catalog.getCatalog.mockResolvedValue(CAT)
    catalog.computePlans.mockResolvedValue([{ slug: 'basic', monthlyPriceInr: 1180, infraMargin: 0 }])
    const out = await costsFor([
      { id: 't1', plan: 'basic', applied: SPEC, applied_at: null, compute_status: 'applied', price_inr_month: 2000 },
      { id: 't2', plan: 'basic', applied: SPEC, applied_at: null, compute_status: 'applied', price_inr_month: null },
      { id: 't3', plan: null, applied: null, applied_at: null, compute_status: null },
    ])
    expect(out.t1.priceMonth).toBe(2903)
    // No stored price: only the plan fee is billed.
    expect(out.t2).toMatchObject({ priceMonth: 1180, marginMonth: -168, mtdEstimate: null })
    expect(out.t3.priceMonth).toBeNull()
    expect(catalog.getCatalog).toHaveBeenCalledTimes(1)
  })

  it('never throws when the catalog or plans can not be read', async () => {
    catalog.getCatalog.mockRejectedValue(new Error('db down'))
    catalog.computePlans.mockRejectedValue(new Error('db down'))
    const out = await costsFor([{ id: 't1', plan: 'basic', applied: SPEC, applied_at: null, compute_status: 'applied' }])
    expect(out.t1.awsMonth).toBe(1168)
  })
})
