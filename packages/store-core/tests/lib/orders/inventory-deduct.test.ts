import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const mockClient = { query: vi.fn() }
vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  queryOne: vi.fn(async () => null),
  queryMany: vi.fn(async () => []),
  queryCount: vi.fn(async () => 0),
  getClient: vi.fn(),
  withTransaction: vi.fn(async (fn: any) => fn(mockClient)),
}))
vi.mock('@/lib/orders/inventory', () => ({
  logStockMovement: vi.fn(async () => {}),
  recomputeStockStatusForProduct: vi.fn(async () => {}),
}))
vi.mock('@/lib/catalog/shelf', () => ({ syncPerishableStock: vi.fn(async () => {}) }))

import {
  InsufficientStockError,
  deleteBatchIfEmpty,
  resolveLineUnit,
  readAvailableStock,
  checkLineStock,
  deductOrderStock,
  deductStockForLines,
} from '@/lib/orders/inventory-deduct'
import { logStockMovement, recomputeStockStatusForProduct } from '@/lib/orders/inventory'
import { syncPerishableStock } from '@/lib/catalog/shelf'

beforeEach(() => {
  vi.clearAllMocks()
  mockClient.query.mockReset()
})

describe('InsufficientStockError', () => {
  it('carries detail + customer message + code', () => {
    const e = new InsufficientStockError('detail', 'friendly')
    expect(e.message).toBe('detail')
    expect(e.customerMessage).toBe('friendly')
    expect(e.code).toBe('OUT_OF_STOCK')
    expect(e.name).toBe('InsufficientStockError')
  })
})

describe('deleteBatchIfEmpty', () => {
  it('false for a null batch, no query', async () => {
    const client = { query: vi.fn() }
    expect(await deleteBatchIfEmpty(client, null)).toBe(false)
    expect(client.query).not.toHaveBeenCalled()
  })
  it('true when a row was deleted', async () => {
    const client = { query: vi.fn(async () => ({ rowCount: 1 })) }
    expect(await deleteBatchIfEmpty(client, 'b1')).toBe(true)
    const client0 = { query: vi.fn(async () => ({ rowCount: 0 })) }
    expect(await deleteBatchIfEmpty(client0, 'b1')).toBe(false)
  })
})

describe('resolveLineUnit', () => {
  it('count unit multiplies by factor for baseQty', async () => {
    const client = { query: vi.fn(async () => ({ rows: [{ unit: 'box', factor: '12', dimension: 'count', qty_step: '1', min_qty: '1', max_qty: null }] })) }
    const r = await resolveLineUnit(client, { product_id: 'p1', quantity: 2, buy_unit: 'box' })
    expect(r.baseQty).toBe(24) // 2 * 12
    expect(r.factor).toBe(12)
    expect(r.unit?.unit).toBe('box')
  })
  it('prefers the snapshotted base_quantity', async () => {
    const client = { query: vi.fn(async () => ({ rows: [] })) }
    const r = await resolveLineUnit(client, { product_id: 'p1', quantity: 2, base_quantity: 30 })
    expect(r.baseQty).toBe(30)
    expect(r.factor).toBe(15) // 30 / 2
  })
  it('uses sold_unit_factor snapshot when no base_quantity', async () => {
    const client = { query: vi.fn(async () => ({ rows: [] })) }
    const r = await resolveLineUnit(client, { product_id: 'p1', quantity: 3, sold_unit_factor: 4 })
    expect(r.baseQty).toBe(12)
  })
  it('no unit row (plain) → baseQty equals qty', async () => {
    const client = { query: vi.fn(async () => ({ rows: [] })) }
    const r = await resolveLineUnit(client, { product_id: 'p1', quantity: 5 })
    expect(r.baseQty).toBe(5)
    expect(r.factor).toBe(1)
  })
})

describe('readAvailableStock', () => {
  it('reads at sub-variant / variant / product grain', async () => {
    const client = { query: vi.fn<(...a: any[]) => any>(async () => ({ rows: [{ inventory_quantity: '42' }] })) }
    expect(await readAvailableStock(client, { product_id: 'p1', sub_variant_id: 'sv1' })).toBe(42)
    expect(client.query.mock.calls[0][0]).toMatch(/FROM product_sub_variants/)
    expect(client.query.mock.calls[0][1]).toEqual(['sv1'])
    await readAvailableStock(client, { product_id: 'p1', variant_id: 'v1' })
    expect(client.query.mock.calls[1][0]).toMatch(/FROM product_variants/)
    await readAvailableStock(client, { product_id: 'p1' })
    expect(client.query.mock.calls[2][0]).toMatch(/FROM products/)
  })
  it('defaults to 0 when no row', async () => {
    const client = { query: vi.fn(async () => ({ rows: [] })) }
    expect(await readAvailableStock(client, { product_id: 'p1' })).toBe(0)
  })
})

describe('checkLineStock', () => {
  it('skips custom lines and sufficient stock, flags a shortfall', async () => {
    // line1: custom (no product_id) → skipped. line2: needs 24, has 10 → shortfall.
    const client = {
      query: vi.fn()
        // resolveLineUnit for line2
        .mockResolvedValueOnce({ rows: [{ unit: 'box', factor: '12', dimension: 'count', qty_step: '1', min_qty: '1', max_qty: null }] })
        // readAvailableStock for line2
        .mockResolvedValueOnce({ rows: [{ inventory_quantity: '10' }] }),
    }
    const out = await checkLineStock(client as any, [
      { product_id: null, quantity: 1, product_name: 'Custom' },
      { product_id: 'p2', quantity: 2, buy_unit: 'box', product_name: 'Widget' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ required_base: 24, available_base: 10, short_base: 14, factor: 12 })
  })
  it('no shortfall when available covers required', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] }) // plain, factor 1
        .mockResolvedValueOnce({ rows: [{ inventory_quantity: '50' }] }),
    }
    const out = await checkLineStock(client as any, [{ product_id: 'p1', quantity: 5, product_name: 'W' }])
    expect(out).toEqual([])
  })
})

describe('deductOrderStock (idempotency + plain deduct)', () => {
  it('no-op when a sale ledger row already exists', async () => {
    mockClient.query.mockImplementation(async (sql: string) => {
      if (/transaction_type = 'sale'\s+LIMIT 1/.test(sql)) return { rows: [{ exists: 1 }] }
      return { rows: [] }
    })
    await deductOrderStock('o1')
    // only the guard query ran; no order_items read
    expect(mockClient.query.mock.calls.some(c => /FROM order_items WHERE order_id/.test(c[0]))).toBe(false)
  })
  it('deducts a plain product line and logs + recomputes', async () => {
    mockClient.query.mockImplementation(async (sql: string, params?: any[]) => {
      if (/transaction_type = 'sale'\s+LIMIT 1/.test(sql)) return { rows: [] } // not yet deducted
      if (/FROM order_items WHERE order_id/.test(sql)) return { rows: [{ id: 'it1', product_id: 'p1', variant_id: null, sub_variant_id: null, product_name: 'W', variant_name: null, quantity: '5', buy_unit: null, sold_unit: null, sold_unit_factor: null, base_quantity: null }] }
      if (/SELECT perishable, serialized FROM products/.test(sql)) return { rows: [{ perishable: false, serialized: false }] }
      if (/product_units/.test(sql)) return { rows: [] } // resolveLineUnit → plain
      if (/SELECT inventory_quantity FROM products WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: [{ inventory_quantity: '20' }] }
      return { rows: [] }
    })
    await deductOrderStock('o1')
    // decremented by baseQty 5
    const dec = mockClient.query.mock.calls.find(c => /UPDATE products SET inventory_quantity = inventory_quantity - \$1/.test(c[0]))!
    expect(dec[1]).toEqual([5, 'p1'])
    expect(vi.mocked(logStockMovement)).toHaveBeenCalledWith(mockClient, expect.objectContaining({ transactionType: 'sale', quantityChange: -5, currentStock: 20 }))
    expect(vi.mocked(recomputeStockStatusForProduct)).toHaveBeenCalledWith(mockClient, 'p1')
  })
  it('throws InsufficientStockError when plain stock is short', async () => {
    mockClient.query.mockImplementation(async (sql: string) => {
      if (/transaction_type = 'sale'\s+LIMIT 1/.test(sql)) return { rows: [] }
      if (/FROM order_items WHERE order_id/.test(sql)) return { rows: [{ id: 'it1', product_id: 'p1', variant_id: null, sub_variant_id: null, product_name: 'W', variant_name: null, quantity: '5', buy_unit: null }] }
      if (/SELECT perishable, serialized FROM products/.test(sql)) return { rows: [{ perishable: false, serialized: false }] }
      if (/product_units/.test(sql)) return { rows: [] }
      if (/FOR UPDATE/.test(sql)) return { rows: [{ inventory_quantity: '2' }] }
      return { rows: [] }
    })
    await expect(deductOrderStock('o1')).rejects.toBeInstanceOf(InsufficientStockError)
  })
})

describe('deductOrderStock — perishable FEFO', () => {
  function script(opts: { avail: any[]; before: Record<string, string> }) {
    mockClient.query.mockImplementation(async (sql: string, params?: any[]) => {
      if (/transaction_type = 'sale'\s+LIMIT 1/.test(sql)) return { rows: [] }
      if (/FROM order_items WHERE order_id/.test(sql)) return { rows: [{ id: 'it1', product_id: 'p1', variant_id: null, sub_variant_id: null, product_name: 'Milk', variant_name: null, quantity: '10', buy_unit: null }] }
      if (/SELECT perishable, serialized FROM products/.test(sql)) return { rows: [{ perishable: true, serialized: false }] }
      if (/product_units/.test(sql)) return { rows: [] } // plain unit → baseQty 10
      if (/FROM product_batches[\s\S]*quantity_remaining > 0/.test(sql)) return { rows: opts.avail } // FEFO list
      if (/SELECT quantity_remaining FROM product_batches WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: [{ quantity_remaining: opts.before[params![0]] }] }
      if (/UPDATE product_batches SET quantity_remaining = quantity_remaining - \$1/.test(sql)) return { rows: [{ lot_number: 'L', expiry_date: null }] }
      if (/DELETE FROM product_batches/.test(sql)) return { rowCount: 0 }
      return { rows: [] }
    })
  }
  it('consumes batches FEFO across two batches', async () => {
    script({ avail: [{ id: 'b1', quantity_remaining: '6' }, { id: 'b2', quantity_remaining: '10' }], before: { b1: '6', b2: '10' } })
    await deductOrderStock('o1')
    const upds = mockClient.query.mock.calls.filter(c => /UPDATE product_batches SET quantity_remaining = quantity_remaining - \$1/.test(c[0]))
    expect(upds.map(c => c[1][0])).toEqual([6, 4]) // 6 from b1, remaining 4 from b2
    expect(vi.mocked(syncPerishableStock)).toHaveBeenCalled()
  })
  it('throws when FEFO cannot cover the quantity', async () => {
    script({ avail: [{ id: 'b1', quantity_remaining: '3' }], before: { b1: '3' } })
    await expect(deductOrderStock('o1')).rejects.toBeInstanceOf(InsufficientStockError)
  })
})

describe('deductStockForLines — serialized', () => {
  it('auto-picks N serials FEFO and marks them sold', async () => {
    mockClient.query.mockImplementation(async (sql: string) => {
      if (/SELECT perishable, serialized FROM products/.test(sql)) return { rows: [{ perishable: false, serialized: true }] }
      if (/product_units/.test(sql)) return { rows: [{ unit: 'pc', factor: '1', dimension: 'count', qty_step: '1', min_qty: '1', max_qty: null }] }
      if (/FROM product_serials ps[\s\S]*status = 'in_stock'/.test(sql)) return { rows: [{ id: 's1', serial_number: 'SN1', batch_id: 'b1' }, { id: 's2', serial_number: 'SN2', batch_id: null }] }
      if (/UPDATE product_serials SET status = 'sold'/.test(sql)) return { rows: [] }
      if (/UPDATE product_batches SET quantity_remaining = GREATEST/.test(sql)) return { rows: [{ lot_number: 'L', expiry_date: null }] }
      if (/DELETE FROM product_batches/.test(sql)) return { rowCount: 0 }
      return { rows: [] }
    })
    await deductStockForLines(mockClient as any, 'o1', [{ id: 'it1', product_id: 'p1', quantity: 2 }])
    const sold = mockClient.query.mock.calls.filter(c => /UPDATE product_serials SET status = 'sold'/.test(c[0]))
    expect(sold).toHaveLength(2)
    expect(vi.mocked(logStockMovement)).toHaveBeenCalledTimes(2)
  })
  it('throws when there are not enough serials', async () => {
    mockClient.query.mockImplementation(async (sql: string) => {
      if (/SELECT perishable, serialized FROM products/.test(sql)) return { rows: [{ perishable: false, serialized: true }] }
      if (/product_units/.test(sql)) return { rows: [{ unit: 'pc', factor: '1', dimension: 'count', qty_step: '1', min_qty: '1', max_qty: null }] }
      if (/FROM product_serials ps/.test(sql)) return { rows: [{ id: 's1', serial_number: 'SN1', batch_id: null }] }
      return { rows: [] }
    })
    await expect(deductStockForLines(mockClient as any, 'o1', [{ id: 'it1', product_id: 'p1', quantity: 2 }])).rejects.toBeInstanceOf(InsufficientStockError)
  })
  it('requireSerialAssignments throws on a count mismatch', async () => {
    mockClient.query.mockImplementation(async (sql: string) => {
      if (/SELECT perishable, serialized FROM products/.test(sql)) return { rows: [{ perishable: false, serialized: true }] }
      if (/product_units/.test(sql)) return { rows: [{ unit: 'pc', factor: '1', dimension: 'count', qty_step: '1', min_qty: '1', max_qty: null }] }
      return { rows: [] }
    })
    await expect(
      deductStockForLines(mockClient as any, 'o1', [{ id: 'it1', product_id: 'p1', quantity: 2 }], { requireSerialAssignments: true, serialAssignments: [{ order_item_id: 'it1', serial_number: 'SN1' }] })
    ).rejects.toThrow(/expected 2 serial number/)
  })
})
