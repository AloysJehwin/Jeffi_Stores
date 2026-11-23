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

import { restoreOrderStock } from '@/lib/orders/order-stock'
import { logStockMovement, recomputeStockStatusForProduct } from '@/lib/orders/inventory'
import { syncPerishableStock } from '@/lib/catalog/shelf'

beforeEach(() => {
  vi.clearAllMocks()
  mockClient.query.mockReset()
})

// A default router that returns [] for everything, overridden per test via a matcher list.
function route(matchers: Array<[RegExp, (sql: string, params?: any[]) => any]>) {
  mockClient.query.mockImplementation(async (sql: string, params?: any[]) => {
    for (const [re, fn] of matchers) if (re.test(sql)) return fn(sql, params)
    return { rows: [] }
  })
}

const plainItem = { product_id: 'p1', variant_id: null, sub_variant_id: null, quantity: '5', buy_unit: null }

describe('restoreOrderStock — plain product', () => {
  it('restores product-grain stock, logs a return and recomputes status', async () => {
    route([
      [/FROM order_items WHERE order_id/, () => ({ rows: [plainItem] })],
      [/LEFT JOIN product_units/, () => ({ rows: [] })], // unit lookup → rawQty passthrough
      [/transaction_type = 'return'\s+LIMIT 1/, () => ({ rows: [] })], // not yet restored
      [/SELECT perishable, serialized FROM products/, () => ({ rows: [{ perishable: false, serialized: false }] })],
      [/SELECT inventory_quantity FROM products WHERE id = \$1 FOR UPDATE/, () => ({ rows: [{ inventory_quantity: '10' }] })],
      [/UPDATE product_serials ps SET status = 'in_stock'/, () => ({ rows: [] })],
      [/UPDATE product_serials ps SET status = 'returned'/, () => ({ rows: [] })],
    ])
    const r = await restoreOrderStock('o1')
    expect(r.skipped).toEqual([])
    const bump = mockClient.query.mock.calls.find(c => /UPDATE products SET inventory_quantity = inventory_quantity \+ \$1/.test(c[0]))!
    expect(bump[1]).toEqual([5, 'p1'])
    expect(vi.mocked(logStockMovement)).toHaveBeenCalledWith(mockClient, expect.objectContaining({ transactionType: 'return', quantityChange: 5, currentStock: 10 }))
    expect(vi.mocked(recomputeStockStatusForProduct)).toHaveBeenCalledWith(mockClient, 'p1')
  })

  it('skips a line already restored (idempotent)', async () => {
    route([
      [/FROM order_items WHERE order_id/, () => ({ rows: [plainItem] })],
      [/LEFT JOIN product_units/, () => ({ rows: [] })],
      [/transaction_type = 'return'\s+LIMIT 1/, () => ({ rows: [{ exists: 1 }] })], // already restored
      [/SELECT perishable, serialized FROM products/, () => ({ rows: [{ perishable: false, serialized: false }] })],
    ])
    await restoreOrderStock('o1')
    expect(mockClient.query.mock.calls.some(c => /UPDATE products SET inventory_quantity/.test(c[0]))).toBe(false)
    expect(vi.mocked(logStockMovement)).not.toHaveBeenCalled()
  })

  it('count-unit line multiplies qty by factor before restoring', async () => {
    route([
      [/FROM order_items WHERE order_id/, () => ({ rows: [{ ...plainItem, quantity: '2', buy_unit: 'box' }] })],
      [/LEFT JOIN product_units/, () => ({ rows: [{ factor: '12', dimension: 'count' }] })],
      [/transaction_type = 'return'\s+LIMIT 1/, () => ({ rows: [] })],
      [/SELECT perishable, serialized FROM products/, () => ({ rows: [{ perishable: false, serialized: false }] })],
      [/SELECT inventory_quantity FROM products WHERE id = \$1 FOR UPDATE/, () => ({ rows: [{ inventory_quantity: '0' }] })],
      [/UPDATE product_serials/, () => ({ rows: [] })],
    ])
    await restoreOrderStock('o1')
    const bump = mockClient.query.mock.calls.find(c => /UPDATE products SET inventory_quantity = inventory_quantity \+ \$1/.test(c[0]))!
    expect(bump[1]).toEqual([24, 'p1']) // 2 * 12
  })
})

describe('restoreOrderStock — variant / sub-variant retired grains', () => {
  it('skips a retired sub-variant (inactive)', async () => {
    route([
      [/FROM order_items WHERE order_id/, () => ({ rows: [{ product_id: 'p1', variant_id: 'v1', sub_variant_id: 'sv1', quantity: '3', buy_unit: null }] })],
      [/LEFT JOIN product_units/, () => ({ rows: [] })],
      [/transaction_type = 'return'\s+LIMIT 1/, () => ({ rows: [] })],
      [/SELECT perishable, serialized FROM products/, () => ({ rows: [{ perishable: false, serialized: false }] })],
      [/FROM product_sub_variants WHERE id = \$1 FOR UPDATE/, () => ({ rows: [{ inventory_quantity: '0', is_active: false }] })],
      [/UPDATE product_serials/, () => ({ rows: [] })],
    ])
    const r = await restoreOrderStock('o1')
    expect(r.skipped).toEqual([{ product_id: 'p1', variant_id: 'v1', sub_variant_id: 'sv1', reason: 'sub-variant is no longer active' }])
    expect(mockClient.query.mock.calls.some(c => /UPDATE product_sub_variants SET inventory_quantity/.test(c[0]))).toBe(false)
  })

  it('restores an active variant-grain line', async () => {
    route([
      [/FROM order_items WHERE order_id/, () => ({ rows: [{ product_id: 'p1', variant_id: 'v1', sub_variant_id: null, quantity: '4', buy_unit: null }] })],
      [/LEFT JOIN product_units/, () => ({ rows: [] })],
      [/transaction_type = 'return'\s+LIMIT 1/, () => ({ rows: [] })],
      [/SELECT perishable, serialized FROM products/, () => ({ rows: [{ perishable: false, serialized: false }] })],
      [/FROM product_variants WHERE id = \$1 FOR UPDATE/, () => ({ rows: [{ inventory_quantity: '6', is_active: true }] })],
      [/UPDATE product_serials/, () => ({ rows: [] })],
    ])
    const r = await restoreOrderStock('o1')
    expect(r.skipped).toEqual([])
    const bump = mockClient.query.mock.calls.find(c => /UPDATE product_variants SET inventory_quantity = inventory_quantity \+ \$1/.test(c[0]))!
    expect(bump[1]).toEqual([4, 'v1'])
    expect(vi.mocked(logStockMovement)).toHaveBeenCalledWith(mockClient, expect.objectContaining({ quantityChange: 4, currentStock: 6 }))
  })

  it('skips a variant that no longer exists', async () => {
    route([
      [/FROM order_items WHERE order_id/, () => ({ rows: [{ product_id: 'p1', variant_id: 'v1', sub_variant_id: null, quantity: '4', buy_unit: null }] })],
      [/LEFT JOIN product_units/, () => ({ rows: [] })],
      [/transaction_type = 'return'\s+LIMIT 1/, () => ({ rows: [] })],
      [/SELECT perishable, serialized FROM products/, () => ({ rows: [{ perishable: false, serialized: false }] })],
      [/FROM product_variants WHERE id = \$1 FOR UPDATE/, () => ({ rows: [] })],
      [/UPDATE product_serials/, () => ({ rows: [] })],
    ])
    const r = await restoreOrderStock('o1')
    expect(r.skipped[0].reason).toBe('variant no longer exists')
  })

  it('restores an active sub-variant-grain line', async () => {
    route([
      [/FROM order_items WHERE order_id/, () => ({ rows: [{ product_id: 'p1', variant_id: 'v1', sub_variant_id: 'sv1', quantity: '3', buy_unit: null }] })],
      [/LEFT JOIN product_units/, () => ({ rows: [] })],
      [/transaction_type = 'return'\s+LIMIT 1/, () => ({ rows: [] })],
      [/SELECT perishable, serialized FROM products/, () => ({ rows: [{ perishable: false, serialized: false }] })],
      [/FROM product_sub_variants WHERE id = \$1 FOR UPDATE/, () => ({ rows: [{ inventory_quantity: '2', is_active: true }] })],
      [/UPDATE product_serials/, () => ({ rows: [] })],
    ])
    const r = await restoreOrderStock('o1')
    expect(r.skipped).toEqual([])
    const bump = mockClient.query.mock.calls.find(c => /UPDATE product_sub_variants SET inventory_quantity = inventory_quantity \+ \$1/.test(c[0]))!
    expect(bump[1]).toEqual([3, 'sv1'])
  })
})

describe('restoreOrderStock — tracked (perishable) line', () => {
  it('restores into an existing batch and logs a return', async () => {
    route([
      [/FROM order_items WHERE order_id/, () => ({ rows: [{ product_id: 'p1', variant_id: null, sub_variant_id: null, quantity: '5', buy_unit: null }] })],
      [/LEFT JOIN product_units/, () => ({ rows: [] })],
      [/transaction_type = 'return'\s+LIMIT 1/, () => ({ rows: [] })],
      [/SELECT perishable, serialized FROM products/, () => ({ rows: [{ perishable: true, serialized: false }] })],
      // restoreTrackedLine: sale movements for this grain
      [/FROM inventory_transactions[\s\S]*transaction_type = 'sale'/, () => ({ rows: [{ id: 'm1', batch_id: 'b1', quantity_change: '-5', serial_number: null, lot_number: 'L1', expiry_date: null }] })],
      // grainIsLeaf
      [/AS is_leaf/, () => ({ rows: [{ is_leaf: true }] })],
      // batch lock read
      [/SELECT quantity_remaining FROM product_batches WHERE id = \$1 FOR UPDATE/, () => ({ rows: [{ quantity_remaining: '2' }] })],
      [/UPDATE product_batches SET quantity_remaining = quantity_remaining \+ \$1/, () => ({ rows: [] })],
      [/UPDATE product_serials/, () => ({ rows: [] })],
    ])
    const r = await restoreOrderStock('o1')
    expect(r.skipped).toEqual([])
    const upd = mockClient.query.mock.calls.find(c => /UPDATE product_batches SET quantity_remaining = quantity_remaining \+ \$1/.test(c[0]))!
    expect(upd[1]).toEqual([5, 'b1']) // abs(-5)
    expect(vi.mocked(logStockMovement)).toHaveBeenCalledWith(mockClient, expect.objectContaining({ transactionType: 'return', quantityChange: 5, batchId: 'b1', currentStock: 2 }))
    expect(vi.mocked(syncPerishableStock)).toHaveBeenCalled()
  })

  it('recreates an emptied batch via the fallback location and relinks serials', async () => {
    route([
      [/FROM order_items WHERE order_id/, () => ({ rows: [{ product_id: 'p1', variant_id: null, sub_variant_id: null, quantity: '2', buy_unit: null }] })],
      [/LEFT JOIN product_units/, () => ({ rows: [] })],
      [/transaction_type = 'return'\s+LIMIT 1/, () => ({ rows: [] })],
      [/SELECT perishable, serialized FROM products/, () => ({ rows: [{ perishable: false, serialized: true }] })],
      // sale movements: batch_id null (the sale emptied & deleted the batch), two serials
      [/FROM inventory_transactions[\s\S]*transaction_type = 'sale'/, () => ({ rows: [
        { id: 'm1', batch_id: null, quantity_change: '-1', serial_number: 'SN1', lot_number: 'LOT', expiry_date: '2027-01-01' },
        { id: 'm2', batch_id: null, quantity_change: '-1', serial_number: 'SN2', lot_number: 'LOT', expiry_date: '2027-01-01' },
      ] })],
      [/AS is_leaf/, () => ({ rows: [{ is_leaf: true }] })],
      // fallbackLocation
      [/ORDER BY pri, ts DESC LIMIT 1/, () => ({ rows: [{ location_id: 'loc1' }] })],
      // recreate batch INSERT
      [/INSERT INTO product_batches/, () => ({ rows: [{ id: 'newb' }] })],
      [/UPDATE product_serials SET batch_id/, () => ({ rows: [] })],
      [/UPDATE product_serials ps SET/, () => ({ rows: [] })],
    ])
    const r = await restoreOrderStock('o1')
    expect(r.skipped).toEqual([])
    // Recreated batch with the summed qty (2) at the fallback location
    const ins = mockClient.query.mock.calls.find(c => /INSERT INTO product_batches/.test(c[0]))!
    expect(ins[1][5]).toBe(2) // quantity = abs(-1)+abs(-1)
    expect(ins[1][6]).toBe('loc1') // location_id
    // Serials relinked to the new batch
    expect(mockClient.query.mock.calls.some(c => /UPDATE product_serials SET batch_id = \$1/.test(c[0]))).toBe(true)
    expect(vi.mocked(logStockMovement)).toHaveBeenCalledTimes(2)
  })

  it('skips a tracked line whose grain no longer holds stock', async () => {
    route([
      [/FROM order_items WHERE order_id/, () => ({ rows: [{ product_id: 'p1', variant_id: 'v1', sub_variant_id: null, quantity: '5', buy_unit: null }] })],
      [/LEFT JOIN product_units/, () => ({ rows: [] })],
      [/transaction_type = 'return'\s+LIMIT 1/, () => ({ rows: [] })],
      [/SELECT perishable, serialized FROM products/, () => ({ rows: [{ perishable: false, serialized: true }] })],
      [/FROM inventory_transactions[\s\S]*transaction_type = 'sale'/, () => ({ rows: [{ id: 'm1', batch_id: 'b1', quantity_change: '-5', serial_number: 'SN1', lot_number: null, expiry_date: null }] })],
      [/AS is_leaf/, () => ({ rows: [{ is_leaf: false }] })], // retired grain
      [/UPDATE product_serials/, () => ({ rows: [] })],
    ])
    const r = await restoreOrderStock('o1')
    expect(r.skipped[0].reason).toMatch(/grain no longer holds stock/)
    expect(vi.mocked(logStockMovement)).not.toHaveBeenCalled()
  })

  it('tracked line with no sale movements falls through to plain restore', async () => {
    route([
      [/FROM order_items WHERE order_id/, () => ({ rows: [{ product_id: 'p1', variant_id: null, sub_variant_id: null, quantity: '5', buy_unit: null }] })],
      [/LEFT JOIN product_units/, () => ({ rows: [] })],
      [/transaction_type = 'return'\s+LIMIT 1/, () => ({ rows: [] })],
      [/SELECT perishable, serialized FROM products/, () => ({ rows: [{ perishable: true, serialized: false }] })],
      [/FROM inventory_transactions[\s\S]*transaction_type = 'sale'/, () => ({ rows: [] })], // no sale moves → false
      [/SELECT inventory_quantity FROM products WHERE id = \$1 FOR UPDATE/, () => ({ rows: [{ inventory_quantity: '1' }] })],
      [/UPDATE product_serials/, () => ({ rows: [] })],
    ])
    const r = await restoreOrderStock('o1')
    expect(r.skipped).toEqual([])
    expect(mockClient.query.mock.calls.some(c => /UPDATE products SET inventory_quantity = inventory_quantity \+ \$1/.test(c[0]))).toBe(true)
  })
})

describe('restoreOrderStock — serials + shelf sync + txClient', () => {
  it('adds a skip entry for serials marked returned at a retired grain', async () => {
    route([
      [/FROM order_items WHERE order_id/, () => ({ rows: [{ product_id: 'p2', variant_id: null, sub_variant_id: null, quantity: '1', buy_unit: null }] })],
      [/LEFT JOIN product_units/, () => ({ rows: [] })],
      [/transaction_type = 'return'\s+LIMIT 1/, () => ({ rows: [{ exists: 1 }] })], // already restored line, skip main loop body
      [/SELECT perishable, serialized FROM products/, () => ({ rows: [{ perishable: false, serialized: false }] })],
      [/UPDATE product_serials ps SET status = 'in_stock'/, () => ({ rows: [] })],
      [/UPDATE product_serials ps SET status = 'returned'/, () => ({ rows: [{ product_id: 'p9', variant_id: 'v9', sub_variant_id: null }] })],
    ])
    const r = await restoreOrderStock('o1')
    expect(r.skipped).toEqual([{ product_id: 'p9', variant_id: 'v9', sub_variant_id: null, reason: 'serials returned to a retired grain; marked returned, not restocked' }])
  })

  it('runs inside a provided txClient (no withTransaction) and restores plain shelf stock', async () => {
    const tx = { query: vi.fn(async (sql: string, params?: any[]) => {
      if (/FROM order_items WHERE order_id/.test(sql)) return { rows: [plainItem] }
      if (/LEFT JOIN product_units/.test(sql)) return { rows: [] }
      if (/transaction_type = 'return'\s+LIMIT 1/.test(sql)) return { rows: [] }
      if (/SELECT perishable, serialized FROM products/.test(sql)) return { rows: [{ perishable: false, serialized: false }] }
      if (/SELECT inventory_quantity FROM products WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: [{ inventory_quantity: '0' }] }
      if (/UPDATE product_serials/.test(sql)) return { rows: [] }
      return { rows: [] }
    }) }
    const r = await restoreOrderStock('o1', tx as any)
    expect(r.skipped).toEqual([])
    // shelf_stock restore for a plain product ran on the given client
    expect(tx.query.mock.calls.some(c => /UPDATE shelf_stock/.test(c[0]))).toBe(true)
  })
})
