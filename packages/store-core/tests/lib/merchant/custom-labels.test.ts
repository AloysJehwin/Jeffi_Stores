import { describe, it, expect, vi } from 'vitest'

const { queryMany } = vi.hoisted(() => ({ queryMany: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryMany }))

import { buildVelocity, itemLabels, marginBand, stockLabel, velocityLabel } from '@/lib/merchant/custom-labels'
import { loadSalesVelocity } from '@/lib/merchant/sales-velocity'

const NOW = new Date('2026-10-16T00:00:00Z')

describe('margin band (custom label 0)', () => {
  it('bands the ex-tax gross margin', () => {
    expect(marginBand(100, 50)).toBe('margin-high')
    expect(marginBand(100, 60)).toBe('margin-high')
    expect(marginBand(100, 61)).toBe('margin-medium')
    expect(marginBand(100, 85)).toBe('margin-low')
    expect(marginBand(100, 100)).toBe('margin-low')
    expect(marginBand(100, 120)).toBe('margin-negative')
  })

  it('is unknown without a cost or price', () => {
    expect(marginBand(100, null)).toBe('margin-unknown')
    expect(marginBand(100, 0)).toBe('margin-unknown')
    expect(marginBand(null, 50)).toBe('margin-unknown')
    expect(marginBand('abc', 50)).toBe('margin-unknown')
  })
})

describe('sales velocity (custom label 1)', () => {
  const v = buildVelocity(
    [
      { sku: 'A', units: 50 },
      { sku: 'b', units: 20 },
      { sku: 'c', units: 3 },
      { sku: 'd', units: 2 },
      { sku: 'e', units: 1 },
      { sku: 'A', units: 5 },
    ],
    60,
    NOW
  )

  it('marks the top 20% of selling SKUs as best sellers (case-insensitive SKUs)', () => {
    expect(v.unitsBySku.get('a')).toBe(55)
    expect(v.bestsellerMin).toBe(55)
    expect(velocityLabel('A', null, v)).toBe('bestseller')
    expect(velocityLabel('B', null, v)).toBe('steady')
  })

  it('tells new products from slow movers when nothing sold', () => {
    expect(velocityLabel('zzz', '2026-10-01', v)).toBe('new')
    expect(velocityLabel('zzz', '2026-01-01', v)).toBe('slow-mover')
    expect(velocityLabel(null, null, v)).toBe('slow-mover')
  })

  it('needs at least two units to call anything a best seller', () => {
    const one = buildVelocity([{ sku: 'x', units: 1 }], 60, NOW)
    expect(one.bestsellerMin).toBe(2)
    expect(velocityLabel('x', null, one)).toBe('steady')
  })

  it('loads one aggregate over paid, kept orders and never throws', async () => {
    queryMany.mockResolvedValueOnce([{ sku: 'tw-1', units: '4.000' }])
    const loaded = await loadSalesVelocity(30)
    expect(queryMany.mock.calls[0][1]).toEqual([30])
    expect(String(queryMany.mock.calls[0][0])).toMatch(/payment_status = 'paid'/)
    expect(loaded.unitsBySku.get('tw-1')).toBe(4)
    queryMany.mockRejectedValueOnce(new Error('db down'))
    expect((await loadSalesVelocity()).unitsBySku.size).toBe(0)
  })
})

describe('stock state (custom label 2)', () => {
  it('follows stock_status, then quantity against the low-stock threshold', () => {
    expect(stockLabel('Out of Stock', 10)).toBe('out-of-stock')
    expect(stockLabel('Low Stock', 10)).toBe('low-stock')
    expect(stockLabel('In Stock', 0)).toBe('in-stock')
    expect(stockLabel(null, 0)).toBe('out-of-stock')
    expect(stockLabel(null, 3, 5)).toBe('low-stock')
    expect(stockLabel(null, 30, 5)).toBe('in-stock')
    expect(stockLabel(null, null)).toBe('in-stock')
  })
})

describe('itemLabels', () => {
  it('combines the three labels, leaving velocity out when sales are unknown', () => {
    const item = { sku: 'A', priceExTax: 100, cost: 50, stockStatus: 'In Stock', quantity: 3 }
    expect(itemLabels(item)).toEqual({ customLabel0: 'margin-high', customLabel2: 'in-stock' })
    expect(itemLabels(item, buildVelocity([{ sku: 'a', units: 9 }], 60, NOW))).toEqual({
      customLabel0: 'margin-high',
      customLabel1: 'bestseller',
      customLabel2: 'in-stock',
    })
  })
})
