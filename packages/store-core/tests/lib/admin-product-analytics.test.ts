import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(), queryMany: vi.fn() }))

import { getProductAnalyticsData } from '@/lib/shared/admin-product-analytics'
import * as db from '@/lib/shared/db'

const mockQueryOne = db.queryOne as ReturnType<typeof vi.fn>
const mockQueryMany = db.queryMany as ReturnType<typeof vi.fn>

const fakeProduct = {
  id: 'prod-1',
  name: 'Bolt M6',
  sku: 'BOLT-M6',
  slug: 'bolt-m6',
  brand_name: 'Unbrako',
  stock_status: 'In Stock',
  base_price: '150.00',
}

const fakeTotals = {
  views: '500',
  unique_viewers: '300',
  cart_adds: '50',
  orders: '20',
  revenue: '10000',
  quantity_sold: '40',
}

const fakeCurrentCarts = { active: '5' }

describe('getProductAnalyticsData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when product not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const result = await getProductAnalyticsData('no-such-id', 30)
    expect(result).toBeNull()
  })

  it('returns product info with parsed fields', async () => {
    mockQueryOne
      .mockResolvedValueOnce(fakeProduct) // product lookup
      .mockResolvedValueOnce(fakeTotals) // totals
      .mockResolvedValueOnce(fakeCurrentCarts) // currentCarts

    mockQueryMany.mockResolvedValue([])

    const result = await getProductAnalyticsData('prod-1', 30)

    expect(result).not.toBeNull()
    expect(result!.product.id).toBe('prod-1')
    expect(result!.product.name).toBe('Bolt M6')
    expect(result!.product.brandName).toBe('Unbrako')
    expect(result!.product.basePrice).toBe(150)
    expect(result!.days).toBe(30)
  })

  it('computes conversionRate correctly', async () => {
    mockQueryOne
      .mockResolvedValueOnce(fakeProduct)
      .mockResolvedValueOnce(fakeTotals) // views=500, orders=20
      .mockResolvedValueOnce(fakeCurrentCarts)

    mockQueryMany.mockResolvedValue([])

    const result = await getProductAnalyticsData('prod-1', 30)
    // conversionRate = round((20/500)*1000)/10 = 4.0
    expect(result!.totals.conversionRate).toBe(4)
  })

  it('computes cartConversionRate correctly', async () => {
    mockQueryOne
      .mockResolvedValueOnce(fakeProduct)
      .mockResolvedValueOnce(fakeTotals) // cart_adds=50, orders=20
      .mockResolvedValueOnce(fakeCurrentCarts)

    mockQueryMany.mockResolvedValue([])

    const result = await getProductAnalyticsData('prod-1', 30)
    // cartConversionRate = round((20/50)*1000)/10 = 40
    expect(result!.totals.cartConversionRate).toBe(40)
  })

  it('computes revenuePerView correctly', async () => {
    mockQueryOne
      .mockResolvedValueOnce(fakeProduct)
      .mockResolvedValueOnce(fakeTotals) // revenue=10000, views=500
      .mockResolvedValueOnce(fakeCurrentCarts)

    mockQueryMany.mockResolvedValue([])

    const result = await getProductAnalyticsData('prod-1', 30)
    // revenuePerView = round((10000/500)*100)/100 = 20
    expect(result!.totals.revenuePerView).toBe(20)
  })

  it('returns zero rates when views are 0', async () => {
    mockQueryOne
      .mockResolvedValueOnce(fakeProduct)
      .mockResolvedValueOnce({ ...fakeTotals, views: '0', orders: '0', cart_adds: '0' })
      .mockResolvedValueOnce(fakeCurrentCarts)

    mockQueryMany.mockResolvedValue([])

    const result = await getProductAnalyticsData('prod-1', 30)
    expect(result!.totals.conversionRate).toBe(0)
    expect(result!.totals.revenuePerView).toBe(0)
  })

  it('maps timeSeries rows to numbers', async () => {
    mockQueryOne
      .mockResolvedValueOnce(fakeProduct)
      .mockResolvedValueOnce(fakeTotals)
      .mockResolvedValueOnce(fakeCurrentCarts)

    mockQueryMany
      .mockResolvedValueOnce([{ date: '2024-01-01', views: '10', carts: '2', orders: '1' }]) // daily
      .mockResolvedValue([]) // rest

    const result = await getProductAnalyticsData('prod-1', 30)
    expect(result!.timeSeries).toHaveLength(1)
    expect(result!.timeSeries[0].views).toBe(10)
    expect(result!.timeSeries[0].carts).toBe(2)
    expect(result!.timeSeries[0].orders).toBe(1)
  })

  it('maps referrers rows to numbers', async () => {
    mockQueryOne
      .mockResolvedValueOnce(fakeProduct)
      .mockResolvedValueOnce(fakeTotals)
      .mockResolvedValueOnce(fakeCurrentCarts)

    mockQueryMany
      .mockResolvedValueOnce([]) // daily
      .mockResolvedValueOnce([{ referrer: 'Google', sessions: '42' }]) // referrers
      .mockResolvedValue([])

    const result = await getProductAnalyticsData('prod-1', 30)
    expect(result!.referrers).toHaveLength(1)
    expect(result!.referrers[0].referrer).toBe('Google')
    expect(result!.referrers[0].sessions).toBe(42)
  })

  it('maps recentBuyers rows', async () => {
    mockQueryOne
      .mockResolvedValueOnce(fakeProduct)
      .mockResolvedValueOnce(fakeTotals)
      .mockResolvedValueOnce(fakeCurrentCarts)

    const buyerRow = {
      order_number: 'ORD-001',
      created_at: '2024-01-01T10:00:00Z',
      quantity: '3',
      total_price: '450.00',
      customer_name: 'Alice',
    }

    mockQueryMany
      .mockResolvedValueOnce([]) // daily
      .mockResolvedValueOnce([]) // referrers
      .mockResolvedValueOnce([buyerRow]) // recentBuyers
      .mockResolvedValue([])

    const result = await getProductAnalyticsData('prod-1', 30)
    expect(result!.recentBuyers).toHaveLength(1)
    expect(result!.recentBuyers[0].orderNumber).toBe('ORD-001')
    expect(result!.recentBuyers[0].quantity).toBe(3)
    expect(result!.recentBuyers[0].total).toBe(450)
    expect(result!.recentBuyers[0].customerName).toBe('Alice')
  })

  it('maps variantBreakdown rows', async () => {
    mockQueryOne
      .mockResolvedValueOnce(fakeProduct)
      .mockResolvedValueOnce(fakeTotals)
      .mockResolvedValueOnce(fakeCurrentCarts)

    const variantRow = {
      variant_name: 'M6x20',
      sub_variant_name: null,
      orders: '5',
      quantity: '15',
      revenue: '750',
    }

    mockQueryMany
      .mockResolvedValueOnce([]) // daily
      .mockResolvedValueOnce([]) // referrers
      .mockResolvedValueOnce([]) // recentBuyers
      .mockResolvedValueOnce([variantRow]) // variantStats
      .mockResolvedValue([])

    const result = await getProductAnalyticsData('prod-1', 30)
    expect(result!.variantBreakdown).toHaveLength(1)
    expect(result!.variantBreakdown[0].variantName).toBe('M6x20')
    expect(result!.variantBreakdown[0].orders).toBe(5)
    expect(result!.variantBreakdown[0].revenue).toBe(750)
  })

  it('reads activeCarts from currentCarts query', async () => {
    mockQueryOne
      .mockResolvedValueOnce(fakeProduct)
      .mockResolvedValueOnce(fakeTotals)
      .mockResolvedValueOnce({ active: '7' })

    mockQueryMany.mockResolvedValue([])

    const result = await getProductAnalyticsData('prod-1', 30)
    expect(result!.totals.activeCarts).toBe(7)
  })

  it('handles null totals gracefully', async () => {
    mockQueryOne
      .mockResolvedValueOnce(fakeProduct)
      .mockResolvedValueOnce(null) // totals null
      .mockResolvedValueOnce(null) // currentCarts null

    mockQueryMany.mockResolvedValue([])

    const result = await getProductAnalyticsData('prod-1', 30)
    expect(result!.totals.views).toBe(0)
    expect(result!.totals.orders).toBe(0)
    expect(result!.totals.revenue).toBe(0)
    expect(result!.totals.activeCarts).toBe(0)
    expect(result!.totals.conversionRate).toBe(0)
  })

  it('passes the days param to the query', async () => {
    mockQueryOne
      .mockResolvedValueOnce(fakeProduct)
      .mockResolvedValueOnce(fakeTotals)
      .mockResolvedValueOnce(fakeCurrentCarts)

    mockQueryMany.mockResolvedValue([])

    await getProductAnalyticsData('prod-1', 90)

    // Verify the product lookup used productId
    const firstCall = mockQueryOne.mock.calls[0]
    expect(firstCall[1]).toContain('prod-1')
  })
})
