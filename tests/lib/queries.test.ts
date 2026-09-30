import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  queryCount: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/catalog/search', () => ({
  buildSearchClause: vi.fn().mockReturnValue({ clause: '1=1', params: [], nextIdx: 2 }),
  buildProductSearchClause: vi.fn().mockReturnValue({ clause: '1=1', params: [], nextIdx: 2 }),
  buildProductSearchRank: vi.fn().mockReturnValue({ rank: '0::int', params: [], nextIdx: 2 }),
  buildVectorSearchClause: vi.fn().mockReturnValue({ clause: '1=1', params: [], nextIdx: 2 }),
}))

vi.mock('@/lib/orders/inventory', () => ({
  getStockValuation: vi.fn().mockResolvedValue({ totalValue: 0 }),
}))

import {
  getDashboardStats,
  getAllProducts,
  getProduct,
  getAllCategories,
  getAllBrands,
  getCategoriesWithProducts,
  getBrandsWithProducts,
  getAllOrders,
  getFilteredOrders,
  getFilteredProducts,
  getFilteredCategories,
  getCustomers,
  getCustomerById,
  getRecentOrders,
  getDashboardMetrics,
  getDashboardAnalytics,
  getOrder,
  getReturnRequest,
  getRevenueTrendBySource,
  getProductBreakdowns,
  getCustomerStats,
  getCustomerSegments,
  getCustomerChannelMix,
  getBrochureProductsByCategories,
  getBrochureProductsByBrands,
  getBrochureProductsByIds,
  VARIANT_STOCK_TOTAL_SQL,
  VARIANT_INVENTORY_TOTAL_SQL,
  VARIANT_MIN_PRICE_SQL,
  VARIANT_MIN_MRP_SQL,
  EFFECTIVE_STOCK_SQL,
  EFFECTIVE_PRICE_SQL,
} from '@/lib/queries'
import { queryOne, queryMany, queryCount } from '@/lib/shared/db'

const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)
const mockQueryCount = vi.mocked(queryCount)

// ---------------------------------------------------------------------------
// SQL constant exports
// ---------------------------------------------------------------------------

describe('SQL constant exports', () => {
  it('VARIANT_STOCK_TOTAL_SQL is a non-empty string', () => {
    expect(typeof VARIANT_STOCK_TOTAL_SQL).toBe('string')
    expect(VARIANT_STOCK_TOTAL_SQL.length).toBeGreaterThan(10)
  })
  it('VARIANT_INVENTORY_TOTAL_SQL is a non-empty string', () => {
    expect(typeof VARIANT_INVENTORY_TOTAL_SQL).toBe('string')
    expect(VARIANT_INVENTORY_TOTAL_SQL.length).toBeGreaterThan(10)
  })
  it('VARIANT_MIN_PRICE_SQL is a non-empty string', () => {
    expect(typeof VARIANT_MIN_PRICE_SQL).toBe('string')
    expect(VARIANT_MIN_PRICE_SQL.length).toBeGreaterThan(10)
  })
  it('VARIANT_MIN_MRP_SQL is a non-empty string', () => {
    expect(typeof VARIANT_MIN_MRP_SQL).toBe('string')
    expect(VARIANT_MIN_MRP_SQL.length).toBeGreaterThan(10)
  })
  it('EFFECTIVE_STOCK_SQL is a non-empty string', () => {
    expect(typeof EFFECTIVE_STOCK_SQL).toBe('string')
    expect(EFFECTIVE_STOCK_SQL.length).toBeGreaterThan(10)
  })
  it('EFFECTIVE_PRICE_SQL is a non-empty string', () => {
    expect(typeof EFFECTIVE_PRICE_SQL).toBe('string')
    expect(EFFECTIVE_PRICE_SQL.length).toBeGreaterThan(10)
  })
})

// ---------------------------------------------------------------------------
// getDashboardStats
// ---------------------------------------------------------------------------

describe('getDashboardStats', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns zeroed stats on DB error', async () => {
    mockQueryCount.mockRejectedValue(new Error('db error'))
    mockQueryOne.mockRejectedValue(new Error('db error'))
    const stats = await getDashboardStats()
    expect(stats.totalProducts).toBe(0)
    expect(stats.totalRevenue).toBe(0)
    expect(stats.totalOrders).toBe(0)
    expect(stats.onlineOrders).toBe(0)
    expect(stats.offlineOrders).toBe(0)
  })

  it('returns parsed stats when DB succeeds', async () => {
    mockQueryCount.mockResolvedValue(42)
    mockQueryOne.mockResolvedValue({ total: '9999.50', online: '5000', offline: '4999.50' } as any)
    const stats = await getDashboardStats()
    expect(stats.totalProducts).toBe(42)
    expect(stats.totalRevenue).toBe(9999.5)
    expect(stats.onlineRevenue).toBe(5000)
    expect(stats.offlineRevenue).toBe(4999.5)
  })

  it('handles null revenue row gracefully', async () => {
    mockQueryCount.mockResolvedValue(0)
    mockQueryOne.mockResolvedValue(null)
    const stats = await getDashboardStats()
    expect(stats.totalRevenue).toBe(0)
  })

  it('returns all required fields', async () => {
    mockQueryCount.mockResolvedValue(5)
    mockQueryOne.mockResolvedValue({ total: '100', online: '60', offline: '40' } as any)
    const stats = await getDashboardStats()
    expect(stats).toHaveProperty('totalProducts')
    expect(stats).toHaveProperty('totalOrders')
    expect(stats).toHaveProperty('onlineOrders')
    expect(stats).toHaveProperty('offlineOrders')
    expect(stats).toHaveProperty('totalRevenue')
    expect(stats).toHaveProperty('totalCustomers')
    expect(stats).toHaveProperty('lowStockProducts')
    expect(stats).toHaveProperty('pendingOrders')
  })
})

// ---------------------------------------------------------------------------
// getAllProducts
// ---------------------------------------------------------------------------

describe('getAllProducts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns array from queryMany', async () => {
    const products = [{ id: 'p1', name: 'Widget' }]
    mockQueryMany.mockResolvedValue(products as any)
    const result = await getAllProducts()
    expect(result).toEqual(products)
    expect(mockQueryMany).toHaveBeenCalledOnce()
  })

  it('returns empty array when no products', async () => {
    mockQueryMany.mockResolvedValue([])
    const result = await getAllProducts()
    expect(result).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// getProduct
// ---------------------------------------------------------------------------

describe('getProduct', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns product when found', async () => {
    const product = { id: 'p1', name: 'Widget' }
    mockQueryOne.mockResolvedValue(product as any)
    const result = await getProduct('p1')
    expect(result).toEqual(product)
  })

  it('throws when product not found', async () => {
    mockQueryOne.mockResolvedValue(null)
    await expect(getProduct('missing')).rejects.toThrow('Product not found')
  })
})

// ---------------------------------------------------------------------------
// getAllCategories / getAllBrands
// ---------------------------------------------------------------------------

describe('getAllCategories', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns categories from queryMany', async () => {
    const cats = [{ id: 'c1', name: 'Tools' }]
    mockQueryMany.mockResolvedValue(cats as any)
    const result = await getAllCategories()
    expect(result).toEqual(cats)
  })
})

describe('getAllBrands', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns brands from queryMany', async () => {
    const brands = [{ id: 'b1', name: 'Acme' }]
    mockQueryMany.mockResolvedValue(brands as any)
    const result = await getAllBrands()
    expect(result).toEqual(brands)
  })
})

// ---------------------------------------------------------------------------
// getCategoriesWithProducts / getBrandsWithProducts
// ---------------------------------------------------------------------------

describe('getCategoriesWithProducts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns categories that have products', async () => {
    const cats = [{ id: 'c1', name: 'Tools' }]
    mockQueryMany.mockResolvedValue(cats as any)
    const result = await getCategoriesWithProducts()
    expect(result).toEqual(cats)
    expect(mockQueryMany).toHaveBeenCalledWith(expect.stringContaining('products'))
  })

  it('returns empty when no categories with products', async () => {
    mockQueryMany.mockResolvedValue([])
    expect(await getCategoriesWithProducts()).toEqual([])
  })
})

describe('getBrandsWithProducts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns brands that have products', async () => {
    const brands = [{ id: 'b1', name: 'Acme' }]
    mockQueryMany.mockResolvedValue(brands as any)
    const result = await getBrandsWithProducts()
    expect(result).toEqual(brands)
    expect(mockQueryMany).toHaveBeenCalledWith(expect.stringContaining('brands'))
  })

  it('returns empty when no brands with products', async () => {
    mockQueryMany.mockResolvedValue([])
    expect(await getBrandsWithProducts()).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// getAllOrders
// ---------------------------------------------------------------------------

describe('getAllOrders', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns orders from queryMany', async () => {
    const orders = [{ id: 'o1', order_number: 'ORD-001' }]
    mockQueryMany.mockResolvedValue(orders as any)
    const result = await getAllOrders()
    expect(result).toEqual(orders)
  })

  it('returns empty when no orders', async () => {
    mockQueryMany.mockResolvedValue([])
    expect(await getAllOrders()).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// getFilteredOrders
// ---------------------------------------------------------------------------

describe('getFilteredOrders', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns orders and total with no filters', async () => {
    const orders = [{ id: 'o1' }]
    mockQueryMany.mockResolvedValue(orders as any)
    mockQueryCount.mockResolvedValue(1)
    const result = await getFilteredOrders({})
    expect(result.orders).toEqual(orders)
    expect(result.total).toBe(1)
  })

  it('applies status filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredOrders({ status: 'pending' })
    expect(mockQueryMany).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining(['pending']))
  })

  it('applies payment_status filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredOrders({ payment_status: 'paid' })
    expect(mockQueryMany).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining(['paid']))
  })

  it('applies source filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredOrders({ source: 'online' })
    expect(mockQueryMany).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining(['online']))
  })

  it('applies search filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredOrders({ search: 'john' })
    expect(mockQueryMany).toHaveBeenCalled()
  })

  it('applies pagination', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredOrders({ page: 2, limit: 10 })
    // offset = (2-1)*10 = 10, limit = 10
    const call = mockQueryMany.mock.calls[0][1] as any[]
    expect(call).toContain(10) // limit
  })

  it('uses default limit 25 and page 1', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredOrders({})
    const call = mockQueryMany.mock.calls[0][1] as any[]
    expect(call).toContain(25) // default limit
    expect(call).toContain(0) // default offset
  })

  it('sorts asc when dir=asc', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredOrders({ sort: 'date', dir: 'asc' })
    const sql = mockQueryMany.mock.calls[0][0] as string
    expect(sql).toContain('ASC')
  })

  it('applies all filters combined', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredOrders({ status: 'pending', payment_status: 'unpaid', source: 'online' })
    const args = mockQueryMany.mock.calls[0][1] as any[]
    expect(args).toContain('pending')
    expect(args).toContain('unpaid')
    expect(args).toContain('online')
  })

  it('applies date_from filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredOrders({ date_from: '2026-01-01' })
    const args = mockQueryMany.mock.calls[0][1] as any[]
    expect(args).toContain('2026-01-01')
  })

  it('applies date_to filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredOrders({ date_to: '2026-07-31' })
    const args = mockQueryMany.mock.calls[0][1] as any[]
    expect(args).toContain('2026-07-31')
  })

  it('applies amount_min and amount_max filters', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredOrders({ amount_min: '100', amount_max: '500' })
    const args = mockQueryMany.mock.calls[0][1] as any[]
    expect(args).toContain('100')
    expect(args).toContain('500')
  })

  it('applies awb filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredOrders({ awb: 'AWB123' })
    const args = mockQueryMany.mock.calls[0][1] as any[]
    expect(args).toContain('AWB123')
  })

  it('applies shipment_status, payment_mode, coupon_code filters', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredOrders({ shipment_status: 'delivered', payment_mode: 'cod', coupon_code: 'SAVE10' })
    const args = mockQueryMany.mock.calls[0][1] as any[]
    expect(args).toContain('delivered')
    expect(args).toContain('cod')
    expect(args).toContain('SAVE10')
  })

  it('handles all new filters together', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredOrders({
      date_from: '2026-01-01',
      date_to: '2026-07-31',
      amount_min: '100',
      amount_max: '5000',
      awb: 'AWB456',
      shipment_status: 'in_transit',
      payment_mode: 'prepaid',
      coupon_code: 'OFF20',
    })
    const args = mockQueryMany.mock.calls[0][1] as any[]
    expect(args).toContain('2026-01-01')
    expect(args).toContain('2026-07-31')
    expect(args).toContain('100')
    expect(args).toContain('5000')
    expect(args).toContain('AWB456')
  })
})

// ---------------------------------------------------------------------------
// getFilteredProducts
// ---------------------------------------------------------------------------

describe('getFilteredProducts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns products and total with no filters', async () => {
    const products = [{ id: 'p1' }]
    mockQueryMany.mockResolvedValue(products as any)
    mockQueryCount.mockResolvedValue(1)
    const result = await getFilteredProducts({})
    expect(result.products).toEqual(products)
    expect(result.total).toBe(1)
  })

  it('applies category_id filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredProducts({ category_id: 'cat-1' })
    expect(mockQueryMany).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining(['cat-1']))
  })

  it('applies brand_id filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredProducts({ brand_id: 'brand-1' })
    expect(mockQueryMany).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining(['brand-1']))
  })

  it('applies is_active=true filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredProducts({ is_active: 'true' })
    expect(mockQueryMany).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([true]))
  })

  it('applies is_active=false filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredProducts({ is_active: 'false' })
    expect(mockQueryMany).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([false]))
  })

  it('applies stock=low filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredProducts({ stock: 'low' })
    const sql = mockQueryMany.mock.calls[0][0] as string
    expect(sql).toContain('Low Stock')
  })

  it('applies stock=out filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredProducts({ stock: 'out' })
    const sql = mockQueryMany.mock.calls[0][0] as string
    expect(sql).toContain('Out of Stock')
  })

  it('applies search filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredProducts({ search: 'bolt' })
    expect(mockQueryMany).toHaveBeenCalled()
  })

  it('applies explicit sort column', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredProducts({ sort: 'name', dir: 'asc' })
    const sql = mockQueryMany.mock.calls[0][0] as string
    expect(sql).toContain('p.name')
    expect(sql).toContain('ASC')
  })

  it('uses default DESC direction', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredProducts({ sort: 'name' })
    const sql = mockQueryMany.mock.calls[0][0] as string
    expect(sql).toContain('DESC')
  })

  it('applies pagination', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredProducts({ page: 3, limit: 5 })
    const args = mockQueryMany.mock.calls[0][1] as any[]
    expect(args).toContain(5) // limit
    expect(args).toContain(10) // offset = (3-1)*5
  })

  it('ignores invalid is_active value', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredProducts({ is_active: 'maybe' })
    // should not crash and should not add is_active filter
    expect(mockQueryMany).toHaveBeenCalled()
  })

  it('applies is_featured filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredProducts({ is_featured: 'true' })
    const args = mockQueryMany.mock.calls[0][1] as any[]
    expect(args).toContain(true)
  })

  it('applies is_featured=false filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredProducts({ is_featured: 'false' })
    const args = mockQueryMany.mock.calls[0][1] as any[]
    expect(args).toContain(false)
  })

  it('applies has_variants=false filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredProducts({ has_variants: 'false' })
    const args = mockQueryMany.mock.calls[0][1] as any[]
    expect(args).toContain(false)
  })

  it('applies is_digital=false filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredProducts({ is_digital: 'false' })
    const args = mockQueryMany.mock.calls[0][1] as any[]
    expect(args).toContain(false)
  })

  it('applies is_bundle=false filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredProducts({ is_bundle: 'false' })
    const args = mockQueryMany.mock.calls[0][1] as any[]
    expect(args).toContain(false)
  })

  it('applies is_cod_allowed=false filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredProducts({ is_cod_allowed: 'false' })
    const args = mockQueryMany.mock.calls[0][1] as any[]
    expect(args).toContain(false)
  })

  it('applies is_oversized=false filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredProducts({ is_oversized: 'false' })
    const args = mockQueryMany.mock.calls[0][1] as any[]
    expect(args).toContain(false)
  })

  it('applies perishable and serialized flags', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredProducts({ perishable: 'true', serialized: 'true' })
    const sql = mockQueryMany.mock.calls[0][0] as string
    expect(sql).toContain('p.perishable = true')
    expect(sql).toContain('p.serialized = true')
  })

  it('applies shipping_class and country_of_origin filters', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredProducts({ shipping_class: 'express', country_of_origin: 'IN' })
    const args = mockQueryMany.mock.calls[0][1] as any[]
    expect(args).toContain('express')
    expect(args).toContain('IN')
  })

  it('applies all new boolean and range filters together', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredProducts({
      is_featured: 'true',
      has_variants: 'true',
      is_digital: 'true',
      is_bundle: 'true',
      is_cod_allowed: 'true',
      is_oversized: 'true',
      fragile: 'true',
      hazardous: 'true',
      perishable: 'true',
      serialized: 'true',
      price_min: '50',
      price_max: '1000',
      gst_percentage: '18',
      condition: 'new',
      grade: 'A',
      shipping_class: 'standard',
      country_of_origin: 'CN',
    })
    const args = mockQueryMany.mock.calls[0][1] as any[]
    expect(args).toContain(true)
    expect(args).toContain('50')
    expect(args).toContain('1000')
  })

  it('applies price_min and price_max filters', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredProducts({ price_min: '100', price_max: '500' })
    const args = mockQueryMany.mock.calls[0][1] as any[]
    expect(args).toContain('100')
    expect(args).toContain('500')
  })

  it('applies gst_percentage filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredProducts({ gst_percentage: '18' })
    const args = mockQueryMany.mock.calls[0][1] as any[]
    expect(args).toContain('18')
  })

  it('applies fragile and hazardous flags', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredProducts({ fragile: 'true', hazardous: 'true' })
    const sql = mockQueryMany.mock.calls[0][0] as string
    expect(sql).toContain('p.fragile = true')
    expect(sql).toContain('p.hazardous = true')
  })

  it('applies condition and grade filters', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredProducts({ condition: 'new', grade: 'A' })
    const args = mockQueryMany.mock.calls[0][1] as any[]
    expect(args).toContain('new')
    expect(args).toContain('A')
  })

  it('applies attribute filters passed through from the query string', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredProducts({
      attributes: { 'spec.thread_type': 'BSW', material: 'Alloy Steel|Carbon Steel', page: '2' },
    })
    const sql = mockQueryMany.mock.calls[0][0] as string
    const args = mockQueryMany.mock.calls[0][1] as any[]
    expect(sql).toContain('jsonb_array_elements_text')
    expect(args).toEqual(expect.arrayContaining(['BSW', 'thread type', 'Alloy Steel', 'Carbon Steel']))
  })
})

// ---------------------------------------------------------------------------
// getFilteredCategories
// ---------------------------------------------------------------------------

describe('getFilteredCategories', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns all categories with no filters', async () => {
    const cats = [{ id: 'c1', name: 'Tools' }]
    mockQueryMany.mockResolvedValue(cats as any)
    const result = await getFilteredCategories({})
    expect(result).toEqual(cats)
  })

  it('applies is_active=true filter', async () => {
    mockQueryMany.mockResolvedValue([])
    await getFilteredCategories({ is_active: 'true' })
    expect(mockQueryMany).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([true]))
  })

  it('applies is_active=false filter', async () => {
    mockQueryMany.mockResolvedValue([])
    await getFilteredCategories({ is_active: 'false' })
    expect(mockQueryMany).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([false]))
  })

  it('applies type=main filter (parent_category_id IS NULL)', async () => {
    mockQueryMany.mockResolvedValue([])
    await getFilteredCategories({ type: 'main' })
    const sql = mockQueryMany.mock.calls[0][0] as string
    expect(sql).toContain('parent_category_id IS NULL')
  })

  it('applies type=sub filter (parent_category_id IS NOT NULL)', async () => {
    mockQueryMany.mockResolvedValue([])
    await getFilteredCategories({ type: 'sub' })
    const sql = mockQueryMany.mock.calls[0][0] as string
    expect(sql).toContain('parent_category_id IS NOT NULL')
  })

  it('applies search filter', async () => {
    mockQueryMany.mockResolvedValue([])
    await getFilteredCategories({ search: 'tools' })
    expect(mockQueryMany).toHaveBeenCalled()
  })

  it('ignores invalid is_active value', async () => {
    mockQueryMany.mockResolvedValue([])
    await getFilteredCategories({ is_active: 'unknown' })
    expect(mockQueryMany).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// getCustomers
// ---------------------------------------------------------------------------

describe('getCustomers', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns customers and total with no filters', async () => {
    const customers = [{ id: 'u1', email: 'a@b.com' }]
    mockQueryMany.mockResolvedValue(customers as any)
    mockQueryCount.mockResolvedValue(1)
    const result = await getCustomers({})
    expect(result.customers).toEqual(customers)
    expect(result.total).toBe(1)
  })

  it('applies status=active filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getCustomers({ status: 'active' })
    const sql = mockQueryMany.mock.calls[0][0] as string
    expect(sql).toContain('is_active = true')
  })

  it('applies status=inactive filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getCustomers({ status: 'inactive' })
    const sql = mockQueryMany.mock.calls[0][0] as string
    expect(sql).toContain('is_active = false')
  })

  it('applies status=flagged filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getCustomers({ status: 'flagged' })
    const sql = mockQueryMany.mock.calls[0][0] as string
    expect(sql).toContain('is_flagged = true')
  })

  it('applies search filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getCustomers({ search: 'john' })
    expect(mockQueryMany).toHaveBeenCalled()
  })

  it('applies tag filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getCustomers({ tag: 'VIP' })
    expect(mockQueryMany).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['vip']) // lowercased
    )
  })

  it('applies segment=b2b filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getCustomers({ segment: 'b2b' })
    const sql = mockQueryMany.mock.calls[0][0] as string
    expect(sql).toContain('gst_number')
  })

  it('applies segment=vip filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getCustomers({ segment: 'vip' })
    const sql = mockQueryMany.mock.calls[0][0] as string
    expect(sql).toContain('50000')
  })

  it('applies segment=loyal filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getCustomers({ segment: 'loyal' })
    const sql = mockQueryMany.mock.calls[0][0] as string
    expect(sql).toContain('paid_orders')
  })

  it('applies segment=repeat filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getCustomers({ segment: 'repeat' })
    const sql = mockQueryMany.mock.calls[0][0] as string
    expect(sql).toContain('order_count')
  })

  it('applies segment=one_time filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getCustomers({ segment: 'one_time' })
    const sql = mockQueryMany.mock.calls[0][0] as string
    expect(sql).toContain('order_count, 0) = 1')
  })

  it('applies segment=new filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getCustomers({ segment: 'new' })
    const sql = mockQueryMany.mock.calls[0][0] as string
    expect(sql).toContain('30 days')
  })

  it('applies segment=at_risk filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getCustomers({ segment: 'at_risk' })
    const sql = mockQueryMany.mock.calls[0][0] as string
    expect(sql).toContain('90 days')
  })

  it('applies segment=dormant filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getCustomers({ segment: 'dormant' })
    const sql = mockQueryMany.mock.calls[0][0] as string
    expect(sql).toContain('180 days')
  })

  it('applies segment=lead filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getCustomers({ segment: 'lead' })
    const sql = mockQueryMany.mock.calls[0][0] as string
    expect(sql).toContain('order_count, 0) = 0')
  })

  it('applies health=healthy filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getCustomers({ health: 'healthy' })
    const sql = mockQueryMany.mock.calls[0][0] as string
    expect(sql).toContain('score >= 70')
  })

  it('applies health=at_risk filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getCustomers({ health: 'at_risk' })
    const sql = mockQueryMany.mock.calls[0][0] as string
    expect(sql).toContain('score >= 40')
  })

  it('applies health=critical filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getCustomers({ health: 'critical' })
    const sql = mockQueryMany.mock.calls[0][0] as string
    expect(sql).toContain('score < 40')
  })

  it('applies health=unknown filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getCustomers({ health: 'unknown' })
    const sql = mockQueryMany.mock.calls[0][0] as string
    expect(sql).toContain('score IS NULL')
  })

  it('applies sort and direction', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getCustomers({ sort: 'email', dir: 'asc' })
    const sql = mockQueryMany.mock.calls[0][0] as string
    expect(sql).toContain('u.email')
    expect(sql).toContain('ASC')
  })

  it('applies pagination', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getCustomers({ page: 2, limit: 20 })
    const args = mockQueryMany.mock.calls[0][1] as any[]
    expect(args).toContain(20) // limit
    expect(args).toContain(20) // offset = (2-1)*20
  })
})

// ---------------------------------------------------------------------------
// getCustomerById
// ---------------------------------------------------------------------------

describe('getCustomerById', () => {
  beforeEach(() => vi.clearAllMocks())

  const mockCustomer = {
    id: 'u1',
    email: 'a@b.com',
    first_name: 'John',
    last_name: 'Doe',
    is_active: true,
    is_flagged: false,
    created_at: new Date('2024-01-01').toISOString(),
    gst_number: null,
    company_name: null,
  }

  const mockStats = {
    total_orders: '3',
    lifetime_value: '60000',
    last_order_at: new Date('2024-06-01').toISOString(),
    paid_orders: '3',
  }

  function setupMocks(customerOverride?: any, statsOverride?: any) {
    let callCount = 0
    mockQueryOne.mockImplementation(() => {
      callCount++
      if (callCount === 1) return Promise.resolve(customerOverride ?? mockCustomer)
      if (callCount === 2) return Promise.resolve(statsOverride ?? mockStats)
      return Promise.resolve(null) // health
    })
    mockQueryMany.mockResolvedValue([])
  }

  it('throws when customer not found', async () => {
    mockQueryOne.mockResolvedValue(null)
    await expect(getCustomerById('missing')).rejects.toThrow('Customer not found')
  })

  it('returns customer with stats and segments', async () => {
    setupMocks()
    const result = await getCustomerById('u1')
    expect(result.id).toBe('u1')
    expect(result.total_orders).toBe(3)
    expect(result.lifetime_value).toBe(60000)
    expect(result.segments).toContain('vip') // 60000 >= 50000
    expect(result.segments).toContain('repeat') // 3 orders
  })

  it('includes b2b segment when gst_number present', async () => {
    setupMocks({ ...mockCustomer, gst_number: '27XXXXX' })
    const result = await getCustomerById('u1')
    expect(result.segments).toContain('b2b')
  })

  it('includes b2b segment when company_name present', async () => {
    setupMocks({ ...mockCustomer, company_name: 'Acme Ltd' })
    const result = await getCustomerById('u1')
    expect(result.segments).toContain('b2b')
  })

  it('includes loyal segment when paidOrders>=5 and lifetimeValue>=25000', async () => {
    setupMocks(undefined, {
      total_orders: '10',
      lifetime_value: '50000',
      last_order_at: null,
      paid_orders: '5',
    })
    const result = await getCustomerById('u1')
    expect(result.segments).toContain('loyal')
  })

  it('includes one_time segment when exactly 1 order', async () => {
    setupMocks(undefined, {
      total_orders: '1',
      lifetime_value: '500',
      last_order_at: null,
      paid_orders: '1',
    })
    const result = await getCustomerById('u1')
    expect(result.segments).toContain('one_time')
  })

  it('includes lead segment when 0 orders', async () => {
    setupMocks(undefined, {
      total_orders: '0',
      lifetime_value: '0',
      last_order_at: null,
      paid_orders: '0',
    })
    const result = await getCustomerById('u1')
    expect(result.segments).toContain('lead')
  })

  it('includes new segment for recently joined customer', async () => {
    const recentDate = new Date(Date.now() - 5 * 86400000).toISOString() // 5 days ago
    setupMocks({ ...mockCustomer, created_at: recentDate })
    const result = await getCustomerById('u1')
    expect(result.segments).toContain('new')
  })

  it('includes at_risk segment for last order 90-180 days ago', async () => {
    const lastOrder = new Date(Date.now() - 100 * 86400000).toISOString() // 100 days ago
    setupMocks(undefined, {
      total_orders: '2',
      lifetime_value: '1000',
      last_order_at: lastOrder,
      paid_orders: '2',
    })
    const result = await getCustomerById('u1')
    expect(result.segments).toContain('at_risk')
  })

  it('includes dormant segment for last order > 180 days ago', async () => {
    const lastOrder = new Date(Date.now() - 200 * 86400000).toISOString() // 200 days ago
    setupMocks(undefined, {
      total_orders: '2',
      lifetime_value: '1000',
      last_order_at: lastOrder,
      paid_orders: '2',
    })
    const result = await getCustomerById('u1')
    expect(result.segments).toContain('dormant')
  })

  it('returns tags, notes, recent_orders, health, assigned_coupons', async () => {
    setupMocks()
    const result = await getCustomerById('u1')
    expect(result).toHaveProperty('tags')
    expect(result).toHaveProperty('notes')
    expect(result).toHaveProperty('recent_orders')
    expect(result).toHaveProperty('health')
    expect(result).toHaveProperty('assigned_coupons')
  })

  it('handles null last_order_at in stats', async () => {
    setupMocks(undefined, {
      total_orders: '0',
      lifetime_value: '0',
      last_order_at: null,
      paid_orders: '0',
    })
    const result = await getCustomerById('u1')
    expect(result.days_since_last_order).toBeNull()
    expect(result.last_order_at).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// getRecentOrders
// ---------------------------------------------------------------------------

describe('getRecentOrders', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns orders from queryMany', async () => {
    const orders = [{ id: 'o1' }, { id: 'o2' }]
    mockQueryMany.mockResolvedValue(orders as any)
    const result = await getRecentOrders()
    expect(result).toEqual(orders)
    expect(mockQueryMany).toHaveBeenCalledWith(expect.any(String), [10])
  })

  it('respects custom limit', async () => {
    mockQueryMany.mockResolvedValue([])
    await getRecentOrders(5)
    expect(mockQueryMany).toHaveBeenCalledWith(expect.any(String), [5])
  })
})

// ---------------------------------------------------------------------------
// getDashboardMetrics
// ---------------------------------------------------------------------------

describe('getDashboardMetrics', () => {
  beforeEach(() => vi.clearAllMocks())

  const periodRevenue = {
    this_month_revenue: '5000',
    last_month_revenue: '4000',
    this_month_orders: '50',
    last_month_orders: '40',
    this_month_customers: '10',
    last_month_customers: '8',
    today_revenue: '200',
    yesterday_revenue: '100',
    online_revenue: '3000',
    offline_revenue: '2000',
  }

  const orderFunnel = {
    pending: '5',
    processing: '3',
    shipped: '2',
    out_for_delivery: '1',
    delivered: '10',
    cancelled: '1',
  }

  it('returns structured metrics object', async () => {
    mockQueryOne.mockResolvedValue(periodRevenue as any)
    mockQueryMany.mockResolvedValue([])
    const result = await getDashboardMetrics()
    expect(result).toHaveProperty('revenue')
    expect(result).toHaveProperty('orders')
    expect(result).toHaveProperty('funnel')
    expect(result).toHaveProperty('topProducts')
    expect(result).toHaveProperty('recentOrders')
  })

  it('calculates revenue correctly', async () => {
    mockQueryOne.mockResolvedValue(periodRevenue as any)
    mockQueryMany.mockResolvedValue([])
    const result = await getDashboardMetrics()
    expect(result.revenue.thisMonth).toBe(5000)
    expect(result.revenue.lastMonth).toBe(4000)
    expect(result.revenue.online).toBe(3000)
    expect(result.revenue.offline).toBe(2000)
    expect(result.revenue.total).toBe(5000)
    expect(result.revenue.today).toBe(200)
    expect(result.revenue.yesterday).toBe(100)
  })

  it('calculates pctChange correctly (non-zero baseline)', async () => {
    mockQueryOne.mockResolvedValue(periodRevenue as any)
    mockQueryMany.mockResolvedValue([])
    const result = await getDashboardMetrics()
    // (5000-4000)/4000 * 100 = 25
    expect(result.revenue.pctChange).toBe(25)
  })

  it('returns null pctChange when baseline is 0', async () => {
    mockQueryOne.mockResolvedValue({
      ...periodRevenue,
      last_month_revenue: '0',
      last_month_orders: '0',
    } as any)
    mockQueryMany.mockResolvedValue([])
    const result = await getDashboardMetrics()
    expect(result.revenue.pctChange).toBeNull()
    expect(result.orders.pctChange).toBeNull()
  })

  it('parses funnel counts', async () => {
    mockQueryOne
      .mockResolvedValueOnce(periodRevenue as any) // periodRevenue
      .mockResolvedValueOnce(orderFunnel as any) // orderFunnel
    mockQueryMany.mockResolvedValue([])
    const result = await getDashboardMetrics()
    expect(result.funnel.pending).toBe(5)
    expect(result.funnel.delivered).toBe(10)
  })

  it('maps topProducts correctly', async () => {
    mockQueryOne.mockResolvedValue(periodRevenue as any)
    const topProducts = [{ product_id: 'p1', name: 'Widget', total_qty: '100', total_revenue: '5000.50' }]
    mockQueryMany
      .mockResolvedValueOnce(topProducts as any) // topProducts query
      .mockResolvedValueOnce([]) // recentOrders query
    const result = await getDashboardMetrics()
    expect(result.topProducts[0]).toMatchObject({
      id: 'p1',
      name: 'Widget',
      qty: 100,
      revenue: 5000.5,
    })
  })

  it('handles null periodRevenue row', async () => {
    mockQueryOne.mockResolvedValue(null)
    mockQueryMany.mockResolvedValue([])
    const result = await getDashboardMetrics()
    expect(result.revenue.thisMonth).toBe(0)
    expect(result.revenue.lastMonth).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// getDashboardAnalytics
// ---------------------------------------------------------------------------

describe('getDashboardAnalytics', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns analytics with default 30d range', async () => {
    mockQueryOne.mockResolvedValue(null)
    mockQueryMany.mockResolvedValue([])
    const result = await getDashboardAnalytics()
    expect(result).toBeDefined()
    expect(typeof result).toBe('object')
  })

  it('accepts today range', async () => {
    mockQueryOne.mockResolvedValue(null)
    mockQueryMany.mockResolvedValue([])
    const result = await getDashboardAnalytics('today')
    expect(result).toBeDefined()
  })

  it('accepts 7d range', async () => {
    mockQueryOne.mockResolvedValue(null)
    mockQueryMany.mockResolvedValue([])
    const result = await getDashboardAnalytics('7d')
    expect(result).toBeDefined()
  })

  it('accepts 90d range', async () => {
    mockQueryOne.mockResolvedValue(null)
    mockQueryMany.mockResolvedValue([])
    const result = await getDashboardAnalytics('90d')
    expect(result).toBeDefined()
  })

  it('processes trend rows, payment, topCategories, topBrands', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        cur_revenue: '5000',
        prev_revenue: '4000',
        cur_orders: '50',
        prev_orders: '40',
        cur_customers: '30',
        prev_customers: '25',
        cur_aov: '100',
        prev_aov: '90',
      }) // kpiRow
      .mockResolvedValueOnce({
        online: '3000',
        cod: '1000',
        other: '500',
        cod_outstanding: '200',
        cod_outstanding_count: '5',
      }) // payRow
      .mockResolvedValueOnce({ new_cust: '20', returning_cust: '10' }) // custSplit
      .mockResolvedValueOnce({ total_buyers: '30', repeat_buyers: '10' }) // buyerRow
      .mockResolvedValueOnce({ total: '100', fulfilled: '80', avg_days: '2.5' }) // invRow
      .mockResolvedValueOnce({ total: '5', fulfilled: '3' }) // retRow
    mockQueryMany
      .mockResolvedValueOnce([{ bucket: '2026-07-01', revenue: '1000', orders: '10' }]) // trendRows
      .mockResolvedValueOnce([{ name: 'Fasteners', units: '50', revenue: '2000' }]) // topCats
      .mockResolvedValueOnce([{ name: 'Brand A', units: '30', revenue: '1500' }]) // topBrandsRows
      .mockResolvedValueOnce([{ name: 'Product 1', qty: '20', revenue: '500' }]) // topProductsRows

    const result = await getDashboardAnalytics('7d')
    expect(result).toBeDefined()
    expect(result.trend?.length).toBeGreaterThan(0)
    expect(result.topCategories?.length).toBeGreaterThan(0)
    expect(result.topBrands?.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// getOrder
// ---------------------------------------------------------------------------

describe('getOrder', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns order when found', async () => {
    mockQueryOne.mockResolvedValue({ id: 'ord-1' } as any)
    const result = await getOrder('ord-1')
    expect(result).toMatchObject({ id: 'ord-1' })
  })

  it('throws when order not found', async () => {
    mockQueryOne.mockResolvedValue(null)
    await expect(getOrder('missing')).rejects.toThrow('Order not found')
  })
})

// ---------------------------------------------------------------------------
// getReturnRequest
// ---------------------------------------------------------------------------

describe('getReturnRequest', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns return request when found', async () => {
    const rr = { id: 'rr-1', order_id: 'ord-1', status: 'pending' }
    mockQueryOne.mockResolvedValue(rr as any)
    const result = await getReturnRequest('ord-1')
    expect(result).toEqual(rr)
  })

  it('returns null when no return request found', async () => {
    mockQueryOne.mockResolvedValue(null)
    const result = await getReturnRequest('ord-1')
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// getDashboardAnalytics — additional range variants + KPI branches
// ---------------------------------------------------------------------------

describe('getDashboardAnalytics — additional ranges', () => {
  beforeEach(() => vi.clearAllMocks())

  it('accepts month range', async () => {
    mockQueryOne.mockResolvedValue(null)
    mockQueryMany.mockResolvedValue([])
    const result = await getDashboardAnalytics('month')
    expect(result.range).toBe('month')
    expect(result.rangeLabel).toBe('This month')
  })

  it('accepts year range', async () => {
    mockQueryOne.mockResolvedValue(null)
    mockQueryMany.mockResolvedValue([])
    const result = await getDashboardAnalytics('year')
    expect(result.range).toBe('year')
    expect(result.rangeLabel).toBe('Last 12 months')
  })

  it('computes aov as 0 when no orders', async () => {
    mockQueryOne.mockResolvedValue({ rev: '0', rev_prev: '0', ord: '0', ord_prev: '0', cust: '0', cust_prev: '0' })
    mockQueryMany.mockResolvedValue([])
    const result = await getDashboardAnalytics('30d')
    expect(result.kpis.aov).toBe(0)
    expect(result.kpis.aovPrev).toBe(0)
  })

  it('computes aov and pctChange when orders exist', async () => {
    mockQueryOne.mockResolvedValue({
      rev: '10000',
      rev_prev: '8000',
      ord: '4',
      ord_prev: '4',
      cust: '2',
      cust_prev: '2',
    })
    mockQueryMany.mockResolvedValue([])
    const result = await getDashboardAnalytics('30d')
    expect(result.kpis.aov).toBe(2500)
    expect(result.kpis.revenuePct).toBe(25)
  })

  it('trend rows have aov=0 when paidOrders=0', async () => {
    mockQueryOne.mockResolvedValue(null)
    mockQueryMany
      .mockResolvedValueOnce([
        { bucket: '2026-07-01', revenue: '500', orders: '3', paid_orders: '0', customers: '2', units: '5' },
      ])
      .mockResolvedValue([])
    const result = await getDashboardAnalytics('7d')
    expect(result.trend[0].aov).toBe(0)
  })

  it('trend rows compute aov when paidOrders>0', async () => {
    mockQueryOne.mockResolvedValue(null)
    mockQueryMany
      .mockResolvedValueOnce([
        { bucket: '2026-07-01', revenue: '600', orders: '3', paid_orders: '2', customers: '2', units: '5' },
      ])
      .mockResolvedValue([])
    const result = await getDashboardAnalytics('7d')
    expect(result.trend[0].aov).toBe(300)
  })

  it('topCategories uses Uncategorized for null name', async () => {
    mockQueryOne.mockResolvedValue(null)
    mockQueryMany
      .mockResolvedValueOnce([]) // trendRows
      .mockResolvedValueOnce([{ name: null, units: '5', revenue: '100' }]) // topCats
      .mockResolvedValue([])
    const result = await getDashboardAnalytics('7d')
    expect(result.topCategories[0].name).toBe('Uncategorized')
  })

  it('topBrands uses No brand for null name', async () => {
    mockQueryOne.mockResolvedValue(null)
    mockQueryMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ name: null, units: '3', revenue: '200' }])
      .mockResolvedValue([])
    const result = await getDashboardAnalytics('7d')
    expect(result.topBrands[0].name).toBe('No brand')
  })

  it('returns populated inventory, returns, payment, buyerSplit sections', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ rev: '0', rev_prev: '0', ord: '0', ord_prev: '0', cust: '0', cust_prev: '0' })
      .mockResolvedValueOnce({
        online: '1000',
        cod: '500',
        other: '0',
        cod_outstanding: '200',
        cod_outstanding_count: '3',
      })
      .mockResolvedValueOnce({ new_cust: '5', returning_cust: '2' })
      .mockResolvedValueOnce({ business: '2', consumer: '8', business_rev: '4000', consumer_rev: '6000' })
      .mockResolvedValueOnce({ in_stock: '10', low_stock: '3', out_of_stock: '2', stock_value: '50000' })
      .mockResolvedValueOnce({ total_returns: '4', rto_in_transit: '1', rto_delivered: '2' })
    mockQueryMany.mockResolvedValue([])
    const result = await getDashboardAnalytics('30d')
    expect(result.inventory.inStock).toBe(10)
    expect(result.inventory.stockValue).toBe(50000)
    expect(result.returns.total).toBe(4)
    expect(result.returns.rtoInTransit).toBe(1)
    expect(result.payment.codOutstanding).toBe(200)
    expect(result.payment.codOutstandingCount).toBe(3)
    expect(result.buyerSplit.business).toBe(2)
    expect(result.customerSplit.newCustomers).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// getRevenueTrendBySource
// ---------------------------------------------------------------------------

describe('getRevenueTrendBySource', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns months and 4-series structure for default 12m', async () => {
    mockQueryMany.mockResolvedValue([])
    const result = await getRevenueTrendBySource()
    expect(Array.isArray(result.months)).toBe(true)
    expect(result.months.length).toBeGreaterThanOrEqual(1)
    expect(result.series.length).toBe(4)
  })

  it('returns correct series sources', async () => {
    mockQueryMany.mockResolvedValue([])
    const result = await getRevenueTrendBySource('3m')
    const sources = result.series.map(s => s.source)
    expect(sources).toContain('online')
    expect(sources).toContain('business')
    expect(sources).toContain('offline')
    expect(sources).toContain('cash_sale')
  })

  it('handles 6m period', async () => {
    mockQueryMany.mockResolvedValue([])
    const result = await getRevenueTrendBySource('6m')
    expect(result.months.length).toBeGreaterThanOrEqual(6)
  })

  it('handles ytd period — months start from January', async () => {
    mockQueryMany.mockResolvedValue([])
    const result = await getRevenueTrendBySource('ytd')
    expect(result.months[0]).toMatch(/^\d{4}-01$/)
  })

  it('handles all period with earliest paid order from DB', async () => {
    mockQueryOne.mockResolvedValue({ m: '2025-06' })
    mockQueryMany.mockResolvedValue([])
    const result = await getRevenueTrendBySource('all')
    expect(result.months[0]).toBe('2025-06')
  })

  it('handles all period when no paid orders in DB', async () => {
    mockQueryOne.mockResolvedValue(null)
    mockQueryMany.mockResolvedValue([])
    const result = await getRevenueTrendBySource('all')
    expect(result.months.length).toBeGreaterThanOrEqual(1)
  })

  it('fills zero for months with no revenue rows', async () => {
    mockQueryMany.mockResolvedValue([])
    const result = await getRevenueTrendBySource('3m')
    for (const s of result.series) {
      for (const pt of s.points) expect(pt).toBe(0)
    }
  })

  it('maps DB rows into correct source bucket', async () => {
    const now = new Date()
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    mockQueryMany.mockResolvedValue([
      { month: thisMonth, source: 'online', revenue: 1500 },
      { month: thisMonth, source: 'business', revenue: 2000 },
    ])
    const result = await getRevenueTrendBySource('3m')
    const onlineSeries = result.series.find(s => s.source === 'online')!
    const bizSeries = result.series.find(s => s.source === 'business')!
    const lastIdx = result.months.length - 1
    expect(onlineSeries.points[lastIdx]).toBe(1500)
    expect(bizSeries.points[lastIdx]).toBe(2000)
  })

  it('ignores rows for unknown sources', async () => {
    const now = new Date()
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    mockQueryMany.mockResolvedValue([{ month: thisMonth, source: 'unknown_src', revenue: 999 }])
    const result = await getRevenueTrendBySource('3m')
    for (const s of result.series) {
      for (const pt of s.points) expect(pt).toBe(0)
    }
  })

  it('catches queryMany errors and returns empty points', async () => {
    mockQueryMany.mockRejectedValue(new Error('DB failure'))
    const result = await getRevenueTrendBySource('12m')
    expect(result.months.length).toBeGreaterThanOrEqual(1)
    for (const s of result.series) {
      expect(s.points.every(p => p === 0)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// getProductBreakdowns
// ---------------------------------------------------------------------------

describe('getProductBreakdowns', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns zeroed stats when all queries return null/empty', async () => {
    mockQueryOne.mockResolvedValue(null)
    mockQueryMany.mockResolvedValue([])
    const result = await getProductBreakdowns()
    expect(result.totalProducts).toBe(0)
    expect(result.activeProducts).toBe(0)
    expect(result.inventoryValue).toBe(0)
    expect(result.byCategory).toEqual([])
    expect(result.byBrand).toEqual([])
    expect(result.byInventoryValue).toEqual([])
  })

  it('returns correct totals from summary row', async () => {
    mockQueryOne.mockResolvedValue({ total: 150, active: 120, featured: 10, categories: 8 })
    mockQueryMany.mockResolvedValue([])
    const result = await getProductBreakdowns()
    expect(result.totalProducts).toBe(150)
    expect(result.activeProducts).toBe(120)
    expect(result.featured).toBe(10)
    expect(result.categories).toBe(8)
  })

  it('builds byCategory slices with colors', async () => {
    mockQueryOne.mockResolvedValue({ total: 5, active: 5, featured: 1, categories: 2 })
    mockQueryMany
      .mockResolvedValueOnce([
        { label: 'Tools', count: 30 },
        { label: 'Fasteners', count: 20 },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    const result = await getProductBreakdowns()
    expect(result.byCategory.length).toBe(2)
    expect(result.byCategory[0].label).toBe('Tools')
    expect(result.byCategory[0].value).toBe(30)
    expect(typeof result.byCategory[0].color).toBe('string')
  })

  it('caps byCategory to topN=8 + Other bucket', async () => {
    mockQueryOne.mockResolvedValue({ total: 100, active: 100, featured: 0, categories: 10 })
    const catRows = Array.from({ length: 10 }, (_, i) => ({ label: `Cat${i}`, count: 10 - i }))
    mockQueryMany
      .mockResolvedValueOnce(catRows)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    const result = await getProductBreakdowns()
    expect(result.byCategory.length).toBe(9) // top 8 + Other
    expect(result.byCategory[8].label).toBe('Other')
  })

  it('maps null label to Uncategorized in slices', async () => {
    mockQueryOne.mockResolvedValue({ total: 5, active: 5, featured: 0, categories: 1 })
    mockQueryMany
      .mockResolvedValueOnce([{ label: null, count: 5 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    const result = await getProductBreakdowns()
    expect(result.byCategory[0].label).toBe('Uncategorized')
  })

  it('builds byInventoryValue from invValueRows, null label → Unnamed', async () => {
    mockQueryOne.mockResolvedValue({ total: 3, active: 3, featured: 0, categories: 1 })
    mockQueryMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { label: 'Widget A', count: 500 },
        { label: null, count: 200 },
      ])
    const result = await getProductBreakdowns()
    expect(result.byInventoryValue[0].label).toBe('Widget A')
    expect(result.byInventoryValue[1].label).toBe('Unnamed')
  })
})

// ---------------------------------------------------------------------------
// getBrochureProductsByCategories / getBrochureProductsByBrands / getBrochureProductsByIds
// ---------------------------------------------------------------------------

describe('getBrochureProductsByCategories', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty array and skips DB when categoryIds is empty', async () => {
    const result = await getBrochureProductsByCategories([])
    expect(result).toEqual([])
    expect(mockQueryMany).not.toHaveBeenCalled()
  })

  it('returns products when categoryIds provided', async () => {
    const products = [{ id: 'p1', name: 'Bolt', category_name: 'Fasteners' }]
    mockQueryMany.mockResolvedValue(products as any)
    const result = await getBrochureProductsByCategories(['cat-1'])
    expect(result).toEqual(products)
  })

  it('passes categoryIds as array param', async () => {
    mockQueryMany.mockResolvedValue([])
    await getBrochureProductsByCategories(['cat-1', 'cat-2'])
    expect(mockQueryMany).toHaveBeenCalledWith(expect.any(String), [['cat-1', 'cat-2']])
  })
})

describe('getBrochureProductsByBrands', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty array and skips DB when brandIds is empty', async () => {
    const result = await getBrochureProductsByBrands([])
    expect(result).toEqual([])
    expect(mockQueryMany).not.toHaveBeenCalled()
  })

  it('returns products when brandIds provided', async () => {
    const products = [{ id: 'p1', name: 'Bolt', brand_name: 'Unbrako' }]
    mockQueryMany.mockResolvedValue(products as any)
    expect(await getBrochureProductsByBrands(['brand-1'])).toEqual(products)
  })

  it('passes brandIds as array param', async () => {
    mockQueryMany.mockResolvedValue([])
    await getBrochureProductsByBrands(['b1', 'b2'])
    expect(mockQueryMany).toHaveBeenCalledWith(expect.any(String), [['b1', 'b2']])
  })
})

describe('getBrochureProductsByIds', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty array and skips DB when productIds is empty', async () => {
    const result = await getBrochureProductsByIds([])
    expect(result).toEqual([])
    expect(mockQueryMany).not.toHaveBeenCalled()
  })

  it('preserves input order of productIds in result', async () => {
    mockQueryMany.mockResolvedValue([
      { id: 'p2', name: 'Nut' },
      { id: 'p1', name: 'Bolt' },
    ] as any)
    const result = await getBrochureProductsByIds(['p1', 'p2'])
    expect(result[0].id).toBe('p1')
    expect(result[1].id).toBe('p2')
  })

  it('filters out ids not returned by DB', async () => {
    mockQueryMany.mockResolvedValue([{ id: 'p1', name: 'Bolt' }] as any)
    const result = await getBrochureProductsByIds(['p1', 'p-missing'])
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('p1')
  })
})

describe('getCustomerStats', () => {
  it('returns real COUNT-based stats', async () => {
    mockQueryOne.mockResolvedValue({ total: 68, active: 68, inactive: 0, flagged: 0 })
    const r = await getCustomerStats()
    expect(r).toEqual({ total: 68, active: 68, inactive: 0, flagged: 0 })
    const sql = String(mockQueryOne.mock.calls[0]![0])
    expect(sql).toContain('COUNT(*) FILTER (WHERE is_active AND NOT is_flagged)')
    expect(sql).toContain('is_guest = false')
  })

  it('defaults to zeros when no row', async () => {
    mockQueryOne.mockResolvedValue(null)
    expect(await getCustomerStats()).toEqual({ total: 0, active: 0, inactive: 0, flagged: 0 })
  })
})

describe('getCustomerSegments', () => {
  it('maps segment counts to BreakdownSlice[]', async () => {
    mockQueryOne.mockResolvedValue({
      vip: 2,
      loyal: 3,
      repeat: 5,
      one_time: 10,
      new: 4,
      at_risk: 1,
      dormant: 6,
      lead: 20,
    })
    const r = await getCustomerSegments()
    const vip = r.find(s => s.label === 'VIP')
    expect(vip?.value).toBe(2)
    expect(r.find(s => s.label === 'Lead')?.value).toBe(20)
    expect(r.every(s => typeof s.color === 'string')).toBe(true)
  })

  it('defaults to zeros when no row', async () => {
    mockQueryOne.mockResolvedValue(null)
    const r = await getCustomerSegments()
    expect(r.every(s => s.value === 0)).toBe(true)
  })
})

describe('getCustomerChannelMix', () => {
  it('maps channel rows to labelled slices, sorted desc', async () => {
    mockQueryMany.mockResolvedValue([
      { channel: 'sms', count: '1' },
      { channel: 'email', count: '67' },
    ])
    const r = await getCustomerChannelMix()
    expect(r[0].label).toBe('Email')
    expect(r[0].value).toBe(67)
    expect(r[1].label).toBe('SMS')
  })

  it('falls back to email label for null channel', async () => {
    mockQueryMany.mockResolvedValue([{ channel: null, count: '5' }])
    const r = await getCustomerChannelMix()
    expect(r[0].label).toBe('Email')
    expect(r[0].value).toBe(5)
  })
})
