import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@jeffi/tenancy', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  getClient: vi.fn(),
}))

vi.mock('../../src/lib/search.js', () => ({
  buildProductSearchClause: vi.fn((_s: string, _n: string, _k: string, i: number) => ({
    clause: `(p.name ILIKE $${i})`,
    params: ['%q%'],
    nextIdx: i + 1,
  })),
  buildProductSearchRank: vi.fn((_s: string, _n: string, _v: string, i: number) => ({
    rank: `rank_expr`,
    params: ['q'],
    nextIdx: i + 1,
  })),
}))

import {
  deriveStockStatus,
  getInventorySync,
  recomputeStockStatusForProduct,
  logStockMovement,
  updateWeightedAvgCost,
  getStockLedger,
  getStockValuation,
} from '../../src/lib/inventory.js'
import { query, queryOne, queryMany } from '@jeffi/tenancy'

const mockQuery = vi.mocked(query)
const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)

beforeEach(() => {
  vi.resetAllMocks()
})

// ── deriveStockStatus ─────────────────────────────────────────────────────
describe('deriveStockStatus', () => {
  it('Out of Stock at qty 0 or negative', () => {
    expect(deriveStockStatus(0, 5)).toBe('Out of Stock')
    expect(deriveStockStatus(-2, 5)).toBe('Out of Stock')
  })
  it('Low Stock when 0 < qty <= threshold', () => {
    expect(deriveStockStatus(3, 5)).toBe('Low Stock')
    expect(deriveStockStatus(5, 5)).toBe('Low Stock')
  })
  it('In Stock above threshold', () => {
    expect(deriveStockStatus(6, 5)).toBe('In Stock')
  })
  it('null threshold → binary In/Out (no Low band)', () => {
    expect(deriveStockStatus(1, null)).toBe('In Stock')
    expect(deriveStockStatus(1)).toBe('In Stock')
    expect(deriveStockStatus(0, null)).toBe('Out of Stock')
  })
})

// ── getInventorySync ──────────────────────────────────────────────────────
describe('getInventorySync', () => {
  it('reads via the standalone query helper when no client, parses threshold', async () => {
    mockQuery.mockResolvedValue({ rows: [{ inventory_sync: true, low_stock_threshold: '7' }] } as any)
    const r = await getInventorySync(null, 'p1')
    expect(r).toEqual({ enabled: true, threshold: 7 })
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('inventory_sync'), ['p1'])
  })
  it('enabled false + null threshold when row missing', async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any)
    expect(await getInventorySync(null, 'p1')).toEqual({ enabled: false, threshold: null })
  })
  it('uses the passed client.query when a client is given', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ inventory_sync: false, low_stock_threshold: null }] }) }
    const r = await getInventorySync(client, 'p2')
    expect(r).toEqual({ enabled: false, threshold: null })
    expect(client.query).toHaveBeenCalledWith(expect.any(String), ['p2'])
    expect(mockQuery).not.toHaveBeenCalled()
  })
})

// ── recomputeStockStatusForProduct ────────────────────────────────────────
describe('recomputeStockStatusForProduct', () => {
  it('no-op when inventory_sync is OFF', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ inventory_sync: false, low_stock_threshold: null }] }) }
    await recomputeStockStatusForProduct(client, 'p1')
    // only the getInventorySync read happened — no UPDATEs
    expect(client.query).toHaveBeenCalledTimes(1)
  })
  it('runs the three grain UPDATEs when ON, passing [productId, threshold]', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ inventory_sync: true, low_stock_threshold: '5' }] }) // getInventorySync
        .mockResolvedValue({ rows: [] }),
    }
    await recomputeStockStatusForProduct(client, 'p1')
    expect(client.query).toHaveBeenCalledTimes(4) // 1 read + 3 updates
    const updateCalls = client.query.mock.calls.slice(1)
    expect(updateCalls[0][0]).toContain('UPDATE product_sub_variants')
    expect(updateCalls[1][0]).toContain('UPDATE product_variants')
    expect(updateCalls[2][0]).toContain('UPDATE products')
    for (const c of updateCalls) expect(c[1]).toEqual(['p1', 5])
  })
})

// ── logStockMovement ──────────────────────────────────────────────────────
describe('logStockMovement', () => {
  const base = {
    productId: 'p1',
    variantId: null,
    transactionType: 'sale' as const,
    quantityChange: -3,
    referenceType: 'order' as const,
    referenceId: 'o1',
  }

  it('uses provided currentStock and computes quantity_after', async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any)
    await logStockMovement(null, { ...base, currentStock: 10 })
    const [sql, values] = mockQuery.mock.calls[0]
    expect(sql).toContain('INSERT INTO inventory_transactions')
    // quantity_after is param index 6 (0-based 5): 10 + (-3) = 7
    expect(values[5]).toBe(7)
    expect(values[4]).toBe(-3) // quantity_change
  })

  it('reads current stock from product_sub_variants when subVariantId set', async () => {
    mockQueryOne.mockResolvedValue({ inventory_quantity: '20' } as any)
    mockQuery.mockResolvedValue({ rows: [] } as any)
    await logStockMovement(null, { ...base, subVariantId: 'sv1', quantityChange: -5 })
    expect(mockQueryOne).toHaveBeenCalledWith(expect.stringContaining('product_sub_variants'), ['sv1'])
    const [, values] = mockQuery.mock.calls[0]
    expect(values[5]).toBe(15) // 20 - 5
  })

  it('reads from product_variants when only variantId set', async () => {
    mockQueryOne.mockResolvedValue({ inventory_quantity: '8' } as any)
    mockQuery.mockResolvedValue({ rows: [] } as any)
    await logStockMovement(null, { ...base, variantId: 'v1', quantityChange: 2 })
    expect(mockQueryOne).toHaveBeenCalledWith(expect.stringContaining('product_variants'), ['v1'])
    const [, values] = mockQuery.mock.calls[0]
    expect(values[5]).toBe(10)
  })

  it('reads from products when neither variant nor sub-variant set', async () => {
    mockQueryOne.mockResolvedValue({ inventory_quantity: '0' } as any)
    mockQuery.mockResolvedValue({ rows: [] } as any)
    await logStockMovement(null, { ...base, quantityChange: 4 })
    expect(mockQueryOne).toHaveBeenCalledWith(expect.stringContaining('FROM products'), ['p1'])
    const [, values] = mockQuery.mock.calls[0]
    expect(values[5]).toBe(4)
  })

  it('writes through the passed client when provided', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    await logStockMovement(client as any, { ...base, currentStock: 5 })
    expect(client.query).toHaveBeenCalledOnce()
    expect(mockQuery).not.toHaveBeenCalled()
  })
})

// ── updateWeightedAvgCost ─────────────────────────────────────────────────
describe('updateWeightedAvgCost', () => {
  it('skips the WAC write entirely for a sub-variant', async () => {
    const client = { query: vi.fn() }
    await updateWeightedAvgCost(client as any, {
      productId: 'p1',
      variantId: 'v1',
      subVariantId: 'sv1',
      qtyReceived: 10,
      unitCost: 5,
    })
    expect(client.query).not.toHaveBeenCalled()
  })

  it('computes weighted avg for a variant: (10*4 + 5*10)/(15) = 6', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ inventory_quantity: '10', cost_price: '4' }] }) // SELECT FOR UPDATE
        .mockResolvedValueOnce({ rows: [] }), // UPDATE
    }
    await updateWeightedAvgCost(client as any, {
      productId: 'p1',
      variantId: 'v1',
      qtyReceived: 5,
      unitCost: 10,
    })
    // (10*4 + 5*10) / 15 = 90/15 = 6
    const updateCall = client.query.mock.calls[1]
    expect(updateCall[0]).toContain('UPDATE product_variants')
    expect(updateCall[1]).toEqual([6, 'v1'])
  })

  it('computes weighted avg for a plain product and round2s the result', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ inventory_quantity: '3', cost_price: '10' }] })
        .mockResolvedValueOnce({ rows: [] }),
    }
    await updateWeightedAvgCost(client as any, { productId: 'p1', variantId: null, qtyReceived: 2, unitCost: 15 })
    // (3*10 + 2*15)/5 = 60/5 = 12
    const updateCall = client.query.mock.calls[1]
    expect(updateCall[0]).toContain('UPDATE products')
    expect(updateCall[1]).toEqual([12, 'p1'])
  })

  it('falls back to unitCost when resulting stock is zero', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ inventory_quantity: '0', cost_price: '0' }] })
        .mockResolvedValueOnce({ rows: [] }),
    }
    await updateWeightedAvgCost(client as any, { productId: 'p1', variantId: null, qtyReceived: 0, unitCost: 9 })
    expect(client.query.mock.calls[1][1]).toEqual([9, 'p1'])
  })
})

// ── getStockLedger ────────────────────────────────────────────────────────
describe('getStockLedger', () => {
  it('returns {rows:[], total} early when no group rows', async () => {
    mockQueryOne.mockResolvedValue({ total: 0 } as any)
    mockQueryMany.mockResolvedValueOnce([] as any) // group rows
    const r = await getStockLedger({})
    expect(r).toEqual({ rows: [], total: 0 })
    // only the count + the group query ran, no child-row query
    expect(mockQueryMany).toHaveBeenCalledOnce()
  })

  it('applies productId/from/to/search filters and returns child rows', async () => {
    mockQueryOne.mockResolvedValue({ total: 2 } as any)
    mockQueryMany
      .mockResolvedValueOnce([{ group_key: 'g1' }] as any) // groups
      .mockResolvedValueOnce([{ id: 'tx1' }] as any) // child rows
    const r = await getStockLedger({ productId: 'p1', from: '2024-01-01', to: '2024-01-31', search: 'bolt' })
    expect(r.total).toBe(2)
    expect(r.rows).toEqual([{ id: 'tx1' }])
    // count query params include productId, from, to (+ search appended '%q%')
    const countParams = mockQueryOne.mock.calls[0][1] as any[]
    expect(countParams).toEqual(expect.arrayContaining(['p1', '2024-01-01', '2024-01-31 23:59:59', '%q%']))
  })
})

// ── getStockValuation ─────────────────────────────────────────────────────
describe('getStockValuation', () => {
  function wireValuation() {
    // 1) filterMeta (queryMany), 2) countRow (queryOne), 3) inStockCount (queryOne),
    // 4) pagedProductIds (queryMany), 5) products (queryMany)
    mockQueryMany
      .mockResolvedValueOnce([
        { category_name: 'Cat A', brand_name: 'Brand Z' },
        { category_name: 'Cat B', brand_name: null },
      ] as any) // filterMeta
      .mockResolvedValueOnce([{ id: 'p1' }] as any) // pagedProductIds
      .mockResolvedValueOnce([{ id: 'p1', name: 'Bolt', stock_value: 100 }] as any) // products
    mockQueryOne
      .mockResolvedValueOnce({ total: 1, total_value: '100', total_value_incl: '118' } as any) // countRow
      .mockResolvedValueOnce({ n: 1 } as any) // inStockCount
  }

  it('aggregates totals, dedupes category/brand lists, returns products', async () => {
    wireValuation()
    const r = await getStockValuation({})
    expect(r.total).toBe(1)
    expect(r.totalValue).toBe(100)
    expect(r.totalValueInclGst).toBe(118)
    expect(r.inStockCount).toBe(1)
    expect(r.allCategories).toEqual(['Cat A', 'Cat B'])
    expect(r.allBrands).toEqual(['Brand Z'])
    expect(r.products).toEqual([{ id: 'p1', name: 'Bolt', stock_value: 100 }])
  })

  it('returns empty products when no page ids (idList.length === 0)', async () => {
    mockQueryMany
      .mockResolvedValueOnce([] as any) // filterMeta
      .mockResolvedValueOnce([] as any) // pagedProductIds → empty
    mockQueryOne
      .mockResolvedValueOnce({ total: 0, total_value: '0', total_value_incl: '0' } as any)
      .mockResolvedValueOnce({ n: 0 } as any)
    const r = await getStockValuation({ search: 'none', categoryName: 'X', brandName: 'Y', stockStatus: 'low_stock' })
    expect(r.products).toEqual([])
    expect(r.total).toBe(0)
    // when idList empty, only 2 queryMany calls (filterMeta + pagedProductIds)
    expect(mockQueryMany).toHaveBeenCalledTimes(2)
  })

  it('applies an explicit sort column path without error', async () => {
    wireValuation()
    const r = await getStockValuation({ sort: 'value', dir: 'asc', stockStatus: 'in_stock' })
    expect(r.total).toBe(1)
  })
})
