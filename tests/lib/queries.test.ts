import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  queryCount: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/search', () => ({
  buildSearchClause: vi.fn().mockReturnValue({ clause: '1=1', params: [], nextIdx: 2 }),
  buildProductSearchClause: vi.fn().mockReturnValue({ clause: '1=1', params: [], nextIdx: 2 }),
  buildProductSearchRank: vi.fn().mockReturnValue({ rank: '0::int', params: [], nextIdx: 2 }),
  buildVectorSearchClause: vi.fn().mockReturnValue({ clause: '1=1', params: [], nextIdx: 2 }),
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
  VARIANT_STOCK_TOTAL_SQL,
  VARIANT_INVENTORY_TOTAL_SQL,
  VARIANT_MIN_PRICE_SQL,
  VARIANT_MIN_MRP_SQL,
  EFFECTIVE_STOCK_SQL,
  EFFECTIVE_PRICE_SQL,
} from '@/lib/queries'
import { queryOne, queryMany, queryCount } from '@/lib/db'

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
    expect(stats.totalRevenue).toBe(9999.50)
    expect(stats.onlineRevenue).toBe(5000)
    expect(stats.offlineRevenue).toBe(4999.50)
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
    expect(mockQueryMany).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['pending'])
    )
  })

  it('applies payment_status filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredOrders({ payment_status: 'paid' })
    expect(mockQueryMany).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['paid'])
    )
  })

  it('applies source filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredOrders({ source: 'online' })
    expect(mockQueryMany).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['online'])
    )
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
    expect(call).toContain(0)  // default offset
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
      date_from: '2026-01-01', date_to: '2026-07-31',
      amount_min: '100', amount_max: '5000',
      awb: 'AWB456', shipment_status: 'in_transit',
      payment_mode: 'prepaid', coupon_code: 'OFF20',
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
    expect(mockQueryMany).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['cat-1'])
    )
  })

  it('applies brand_id filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredProducts({ brand_id: 'brand-1' })
    expect(mockQueryMany).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['brand-1'])
    )
  })

  it('applies is_active=true filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredProducts({ is_active: 'true' })
    expect(mockQueryMany).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([true])
    )
  })

  it('applies is_active=false filter', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    await getFilteredProducts({ is_active: 'false' })
    expect(mockQueryMany).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([false])
    )
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
    expect(args).toContain(5)   // limit
    expect(args).toContain(10)  // offset = (3-1)*5
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
      is_featured: 'true', has_variants: 'true', is_digital: 'true',
      is_bundle: 'true', is_cod_allowed: 'true', is_oversized: 'true',
      fragile: 'true', hazardous: 'true', perishable: 'true', serialized: 'true',
      price_min: '50', price_max: '1000', gst_percentage: '18',
      condition: 'new', grade: 'A', shipping_class: 'standard',
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
    expect(mockQueryMany).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([true])
    )
  })

  it('applies is_active=false filter', async () => {
    mockQueryMany.mockResolvedValue([])
    await getFilteredCategories({ is_active: 'false' })
    expect(mockQueryMany).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([false])
    )
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
      expect.arrayContaining(['vip'])  // lowercased
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
    expect(args).toContain(20)  // limit
    expect(args).toContain(20)  // offset = (2-1)*20
  })
})

// ---------------------------------------------------------------------------
// getCustomerById
// ---------------------------------------------------------------------------

describe('getCustomerById', () => {
  beforeEach(() => vi.clearAllMocks())

  const mockCustomer = {
    id: 'u1', email: 'a@b.com', first_name: 'John', last_name: 'Doe',
    is_active: true, is_flagged: false, created_at: new Date('2024-01-01').toISOString(),
    gst_number: null, company_name: null,
  }

  const mockStats = {
    total_orders: '3', lifetime_value: '60000', last_order_at: new Date('2024-06-01').toISOString(), paid_orders: '3',
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
    expect(result.segments).toContain('vip')   // 60000 >= 50000
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
      total_orders: '10', lifetime_value: '50000', last_order_at: null, paid_orders: '5',
    })
    const result = await getCustomerById('u1')
    expect(result.segments).toContain('loyal')
  })

  it('includes one_time segment when exactly 1 order', async () => {
    setupMocks(undefined, {
      total_orders: '1', lifetime_value: '500', last_order_at: null, paid_orders: '1',
    })
    const result = await getCustomerById('u1')
    expect(result.segments).toContain('one_time')
  })

  it('includes lead segment when 0 orders', async () => {
    setupMocks(undefined, {
      total_orders: '0', lifetime_value: '0', last_order_at: null, paid_orders: '0',
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
      total_orders: '2', lifetime_value: '1000', last_order_at: lastOrder, paid_orders: '2',
    })
    const result = await getCustomerById('u1')
    expect(result.segments).toContain('at_risk')
  })

  it('includes dormant segment for last order > 180 days ago', async () => {
    const lastOrder = new Date(Date.now() - 200 * 86400000).toISOString() // 200 days ago
    setupMocks(undefined, {
      total_orders: '2', lifetime_value: '1000', last_order_at: lastOrder, paid_orders: '2',
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
      total_orders: '0', lifetime_value: '0', last_order_at: null, paid_orders: '0',
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
    this_month_revenue: '5000', last_month_revenue: '4000',
    this_month_orders: '50', last_month_orders: '40',
    this_month_customers: '10', last_month_customers: '8',
    today_revenue: '200', yesterday_revenue: '100',
    online_revenue: '3000', offline_revenue: '2000',
  }

  const orderFunnel = {
    pending: '5', processing: '3', shipped: '2',
    out_for_delivery: '1', delivered: '10', cancelled: '1',
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
      ...periodRevenue, last_month_revenue: '0', last_month_orders: '0',
    } as any)
    mockQueryMany.mockResolvedValue([])
    const result = await getDashboardMetrics()
    expect(result.revenue.pctChange).toBeNull()
    expect(result.orders.pctChange).toBeNull()
  })

  it('parses funnel counts', async () => {
    mockQueryOne
      .mockResolvedValueOnce(periodRevenue as any)   // periodRevenue
      .mockResolvedValueOnce(orderFunnel as any)      // orderFunnel
    mockQueryMany.mockResolvedValue([])
    const result = await getDashboardMetrics()
    expect(result.funnel.pending).toBe(5)
    expect(result.funnel.delivered).toBe(10)
  })

  it('maps topProducts correctly', async () => {
    mockQueryOne.mockResolvedValue(periodRevenue as any)
    const topProducts = [
      { product_id: 'p1', name: 'Widget', total_qty: '100', total_revenue: '5000.50' },
    ]
    mockQueryMany
      .mockResolvedValueOnce(topProducts as any)   // topProducts query
      .mockResolvedValueOnce([])                    // recentOrders query
    const result = await getDashboardMetrics()
    expect(result.topProducts[0]).toMatchObject({
      id: 'p1', name: 'Widget', qty: 100, revenue: 5000.50,
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
      .mockResolvedValueOnce({ cur_revenue: '5000', prev_revenue: '4000', cur_orders: '50', prev_orders: '40', cur_customers: '30', prev_customers: '25', cur_aov: '100', prev_aov: '90' }) // kpiRow
      .mockResolvedValueOnce({ online: '3000', cod: '1000', other: '500', cod_outstanding: '200', cod_outstanding_count: '5' }) // payRow
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
