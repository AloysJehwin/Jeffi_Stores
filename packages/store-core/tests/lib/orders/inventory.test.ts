import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const dbQuery = vi.fn<(...a: any[]) => any>(async () => ({ rows: [], rowCount: 0 }))
const dbQueryOne = vi.fn<(...a: any[]) => any>(async () => null)
const dbQueryMany = vi.fn<(...a: any[]) => any>(async () => [])
vi.mock('@/lib/shared/db', () => ({
  query: (...a: any[]) => (dbQuery as any)(...a),
  queryOne: (...a: any[]) => (dbQueryOne as any)(...a),
  queryMany: (...a: any[]) => (dbQueryMany as any)(...a),
  queryCount: vi.fn(async () => 0),
  getClient: vi.fn(),
  withTransaction: vi.fn(),
}))
// filter-registry deps are static data; keep them real-ish via light stubs.
vi.mock('@jeffi/list-filters', () => ({
  orderByClause: vi.fn(() => 'ORDER BY ts DESC'),
  parseSort: vi.fn(() => null),
}))
vi.mock('@/lib/filters/fields/inventory', () => ({ LEDGER_COUNT_CAP: 1000 }))
vi.mock('@/lib/filters/entities/inventory', () => ({ LEDGER_SORTS: {}, VAL_SORTS: {} }))
vi.mock('@/lib/catalog/search', () => ({
  buildProductSearchClause: vi.fn((_s: string, _n: string, _k: string, _v: string, i: number) => ({ clause: `p.name ILIKE $${i}`, params: ['%q%'], nextIdx: i + 1 })),
  buildProductSearchRank: vi.fn((_s: string, _n: string, _v: string, i: number) => ({ rank: '1', params: [], nextIdx: i })),
}))

import {
  deriveStockStatus,
  getInventorySync,
  recomputeStockStatusForProduct,
  logStockMovement,
  updateWeightedAvgCost,
  getStockLedger,
  getStockValuation,
} from '@/lib/orders/inventory'

beforeEach(() => {
  vi.clearAllMocks()
  dbQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 } as any)
  dbQueryOne.mockReset().mockResolvedValue(null as any)
  dbQueryMany.mockReset().mockResolvedValue([] as any)
})

describe('deriveStockStatus', () => {
  it('maps qty + threshold to a status', () => {
    expect(deriveStockStatus(0)).toBe('Out of Stock')
    expect(deriveStockStatus(-5)).toBe('Out of Stock')
    expect(deriveStockStatus(5)).toBe('In Stock')
    expect(deriveStockStatus(3, 5)).toBe('Low Stock')
    expect(deriveStockStatus(10, 5)).toBe('In Stock')
    expect(deriveStockStatus(3, null)).toBe('In Stock') // no low band
  })
})

describe('getInventorySync', () => {
  it('uses the client when given and parses the row', async () => {
    const client = { query: vi.fn(async () => ({ rows: [{ inventory_sync: true, low_stock_threshold: '7' }] })) }
    const r = await getInventorySync(client, 'p1')
    expect(r).toEqual({ enabled: true, threshold: 7 })
    expect(client.query).toHaveBeenCalled()
    expect(dbQuery).not.toHaveBeenCalled()
  })
  it('falls back to the pool query, disabled + null threshold when no row', async () => {
    dbQuery.mockResolvedValueOnce({ rows: [] } as any)
    const r = await getInventorySync(null, 'p1')
    expect(r).toEqual({ enabled: false, threshold: null })
    expect(dbQuery).toHaveBeenCalled()
  })
})

describe('recomputeStockStatusForProduct', () => {
  it('no-op when inventory_sync disabled', async () => {
    const client = { query: vi.fn(async () => ({ rows: [{ inventory_sync: false, low_stock_threshold: null }] })) }
    await recomputeStockStatusForProduct(client, 'p1')
    expect(client.query).toHaveBeenCalledTimes(1) // only the getInventorySync read
  })
  it('runs 3 cascade UPDATEs when enabled', async () => {
    const client = { query: vi.fn<(...a: any[]) => any>(async () => ({ rows: [{ inventory_sync: true, low_stock_threshold: '5' }] })) }
    await recomputeStockStatusForProduct(client, 'p1')
    // 1 read + 3 updates
    expect(client.query).toHaveBeenCalledTimes(4)
    expect(client.query.mock.calls[1][0]).toMatch(/UPDATE product_sub_variants/)
    expect(client.query.mock.calls[2][0]).toMatch(/UPDATE product_variants/)
    expect(client.query.mock.calls[3][0]).toMatch(/UPDATE products/)
    expect(client.query.mock.calls[1][1]).toEqual(['p1', 5])
  })
})

describe('logStockMovement', () => {
  it('uses the given currentStock and writes quantityAfter via client', async () => {
    const client = { query: vi.fn<(...a: any[]) => any>(async () => ({ rows: [] })) }
    await logStockMovement(client as any, {
      productId: 'p1', variantId: null, transactionType: 'sale', quantityChange: -3,
      referenceType: 'order', referenceId: 'o1', currentStock: 10,
    })
    const [, values] = client.query.mock.calls[0] as [string, any[]]
    expect(values[4]).toBe(-3) // quantity_change
    expect(values[5]).toBe(7) // quantity_after = 10 + (-3)
  })
  it('reads current stock at the sub-variant grain when not provided', async () => {
    dbQueryOne.mockResolvedValueOnce({ inventory_quantity: 20 } as any)
    await logStockMovement(null, {
      productId: 'p1', variantId: 'v1', subVariantId: 'sv1', transactionType: 'return', quantityChange: 5,
      referenceType: 'order', referenceId: 'o1',
    })
    expect(dbQueryOne.mock.calls[0][0]).toMatch(/FROM product_sub_variants/)
    const [, values] = dbQuery.mock.calls[0] as [string, any[]]
    expect(values[5]).toBe(25)
  })
  it('reads variant grain, then product grain, defaulting to 0', async () => {
    dbQueryOne.mockResolvedValueOnce({ inventory_quantity: 8 } as any)
    await logStockMovement(null, { productId: 'p1', variantId: 'v1', transactionType: 'sale', quantityChange: -1, referenceType: 'order', referenceId: 'o1' })
    expect(dbQueryOne.mock.calls[0][0]).toMatch(/FROM product_variants/)
    dbQueryOne.mockResolvedValueOnce(null as any)
    await logStockMovement(null, { productId: 'p1', variantId: null, transactionType: 'sale', quantityChange: -2, referenceType: 'order', referenceId: 'o1' })
    expect(dbQueryOne.mock.calls[1][0]).toMatch(/FROM products/)
    const [, values] = dbQuery.mock.calls[1] as [string, any[]]
    expect(values[5]).toBe(-2) // 0 + (-2)
  })
})

describe('updateWeightedAvgCost', () => {
  it('skips sub-variant WAC (no cost column)', async () => {
    const client = { query: vi.fn<(...a: any[]) => any>() }
    await updateWeightedAvgCost(client as any, { productId: 'p1', variantId: 'v1', subVariantId: 'sv1', qtyReceived: 5, unitCost: 100 })
    expect(client.query).not.toHaveBeenCalled()
  })
  it('weighted-average at variant grain', async () => {
    const client = { query: vi.fn<(...a: any[]) => any>(async () => ({ rows: [{ inventory_quantity: 10, cost_price: 100 }] })) }
    await updateWeightedAvgCost(client as any, { productId: 'p1', variantId: 'v1', qtyReceived: 10, unitCost: 200 })
    // (10*100 + 10*200)/20 = 150
    const upd = client.query.mock.calls.find((c: any[]) => /UPDATE product_variants SET cost_price/.test(c[0]))!
    expect(upd[1][0]).toBe(150)
  })
  it('product grain, uses unitCost when no prior stock', async () => {
    const client = { query: vi.fn<(...a: any[]) => any>(async () => ({ rows: [{ inventory_quantity: 0, cost_price: 0 }] })) }
    await updateWeightedAvgCost(client as any, { productId: 'p1', variantId: null, qtyReceived: 0, unitCost: 250 })
    const upd = client.query.mock.calls.find((c: any[]) => /UPDATE products SET cost_price/.test(c[0]))!
    expect(upd[1][0]).toBe(250)
  })
})

describe('getStockLedger', () => {
  it('returns empty rows when no group rows match', async () => {
    dbQueryOne.mockResolvedValueOnce({ total: 3 } as any) // count
    dbQueryMany.mockResolvedValueOnce([] as any) // group keys
    const r = await getStockLedger({ productId: 'p1', from: '2026-01-01', to: '2026-02-01', search: 'wire' })
    expect(r).toEqual({ rows: [], total: 3, capped: false })
  })
  it('fetches child rows for the page and flags capped over the cap', async () => {
    dbQueryOne.mockResolvedValueOnce({ total: 1500 } as any) // > LEDGER_COUNT_CAP(1000)
    dbQueryMany
      .mockResolvedValueOnce([{ group_key: 'g1' }] as any) // group keys
      .mockResolvedValueOnce([{ id: 'r1' }] as any) // child rows
    const r = await getStockLedger({ limit: 10, offset: 0 })
    expect(r.total).toBe(1000) // clamped
    expect(r.capped).toBe(true)
    expect(r.rows).toEqual([{ id: 'r1' }])
  })
})

describe('getStockValuation', () => {
  it('aggregates totals, categories and brands; paginates products', async () => {
    dbQueryMany
      .mockResolvedValueOnce([{ category_name: 'Cat', brand_name: 'Br' }, { category_name: 'Cat', brand_name: null }] as any) // filterMeta
    dbQueryOne
      .mockResolvedValueOnce({ total: 2, total_value: '500', total_value_incl: '590' } as any) // count
      .mockResolvedValueOnce({ n: 1 } as any) // inStockCount
    dbQueryMany
      .mockResolvedValueOnce([{ id: 'p1' }] as any) // paged ids
      .mockResolvedValueOnce([{ id: 'p1', name: 'Widget' }] as any) // products
    const r = await getStockValuation({ search: 'wid', categoryName: 'Cat', brandName: 'Br', stockStatus: 'low_stock' })
    expect(r.total).toBe(2)
    expect(r.totalValue).toBe(500)
    expect(r.totalValueInclGst).toBe(590)
    expect(r.inStockCount).toBe(1)
    expect(r.allCategories).toEqual(['Cat'])
    expect(r.allBrands).toEqual(['Br'])
    expect(r.products).toEqual([{ id: 'p1', name: 'Widget' }])
  })
  it('returns no products when the page is empty', async () => {
    dbQueryMany.mockResolvedValueOnce([] as any) // filterMeta
    dbQueryOne
      .mockResolvedValueOnce({ total: 0, total_value: '0', total_value_incl: '0' } as any)
      .mockResolvedValueOnce({ n: 0 } as any)
    dbQueryMany.mockResolvedValueOnce([] as any) // paged ids empty → no products query
    const r = await getStockValuation({ stockStatus: 'in_stock' })
    expect(r.products).toEqual([])
    expect(r.total).toBe(0)
  })
})
