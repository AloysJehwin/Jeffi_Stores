import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({ withTransaction: vi.fn() }))
vi.mock('@/lib/inventory', () => ({ logStockMovement: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/shelf', () => ({ syncPerishableStock: vi.fn().mockResolvedValue(undefined) }))

import { deductOrderStock } from '@/lib/inventory-deduct'
import { logStockMovement } from '@/lib/inventory'
import { syncPerishableStock } from '@/lib/shelf'

// A scripted fake pg client: responses keyed by call index, default { rows: [] }.
// Also records every SQL string so we can assert ordering/content.
function makeClient(responses: Record<number, any> = {}) {
  let idx = 0
  const calls: { sql: string; params: any[] }[] = []
  const client: any = {
    calls,
    query: vi.fn().mockImplementation(async (sql: string, params: any[] = []) => {
      calls.push({ sql, params })
      const r = responses[idx] ?? { rows: [] }
      idx++
      return r
    }),
  }
  return client
}

const PLAIN = { perishable: false, serialized: false }

beforeEach(() => vi.clearAllMocks())

describe('deductOrderStock — idempotency', () => {
  it('no-ops when a sale ledger row already exists for the order', async () => {
    const client = makeClient({ 0: { rows: [{ x: 1 }] } }) // sale guard hit
    await deductOrderStock('ord-1', {}, client)
    expect(client.query).toHaveBeenCalledTimes(1) // only the guard query
    expect(logStockMovement).not.toHaveBeenCalled()
  })
})

describe('deductOrderStock — plain product', () => {
  it('decrements inventory_quantity by base qty and logs a sale', async () => {
    const client = makeClient({
      0: { rows: [] }, // sale guard: none
      1: { rows: [{ id: 'oi1', product_id: 'p1', variant_id: null, sub_variant_id: null, product_name: 'Widget', variant_name: null, quantity: '3', buy_unit: null }] }, // order_items
      2: { rows: [] }, // unit row (none → plain integer)
      3: { rows: [PLAIN] }, // products flags
      4: { rows: [{ inventory_quantity: '10' }] }, // FOR UPDATE stock
      5: { rows: [] }, // UPDATE inventory
    })
    await deductOrderStock('ord-1', {}, client)
    expect(logStockMovement).toHaveBeenCalledWith(client, expect.objectContaining({
      transactionType: 'sale', quantityChange: -3, referenceId: 'ord-1',
    }))
    // plain product → no perishable sync
    expect(syncPerishableStock).not.toHaveBeenCalled()
  })

  it('count-dimension multiplies by factor (box of 12 → 24 pieces)', async () => {
    const client = makeClient({
      0: { rows: [] },
      1: { rows: [{ id: 'oi1', product_id: 'p1', variant_id: null, sub_variant_id: null, product_name: 'Box', variant_name: null, quantity: '2', buy_unit: 'box' }] },
      2: { rows: [{ unit: 'box', factor: '12', dimension: 'count', qty_step: '1', min_qty: '1', max_qty: null }] },
      3: { rows: [PLAIN] },
      4: { rows: [{ inventory_quantity: '100' }] },
      5: { rows: [] },
    })
    await deductOrderStock('ord-1', {}, client)
    expect(logStockMovement).toHaveBeenCalledWith(client, expect.objectContaining({ quantityChange: -24 }))
  })

  it('throws when stock is insufficient', async () => {
    const client = makeClient({
      0: { rows: [] },
      1: { rows: [{ id: 'oi1', product_id: 'p1', variant_id: null, sub_variant_id: null, product_name: 'Widget', variant_name: null, quantity: '9', buy_unit: null }] },
      2: { rows: [] },
      3: { rows: [PLAIN] },
      4: { rows: [{ inventory_quantity: '5' }] }, // only 5 available, need 9
    })
    await expect(deductOrderStock('ord-1', {}, client)).rejects.toThrow(/Insufficient stock/i)
  })
})

describe('deductOrderStock — perishable auto-FEFO', () => {
  it('consumes across two batches in FEFO order for a fractional (metre) sale', async () => {
    // Sell 2.5 m; batch b1 has 1.0 remaining (nearest expiry), b2 has 5.0.
    const client = makeClient({
      0: { rows: [] }, // guard
      1: { rows: [{ id: 'oi1', product_id: 'p1', variant_id: null, sub_variant_id: null, product_name: 'Cable', variant_name: null, quantity: '2.5', buy_unit: 'm' }] },
      2: { rows: [{ unit: 'm', factor: '1', dimension: 'length', qty_step: '0.5', min_qty: '0.5', max_qty: null }] },
      3: { rows: [{ perishable: true, serialized: false }] },
      4: { rows: [ { id: 'b1', quantity_remaining: '1.000' }, { id: 'b2', quantity_remaining: '5.000' } ] }, // FEFO available list
      5: { rows: [{ quantity_remaining: '1.000' }] }, // b1 lock
      6: { rows: [{ lot_number: 'L1', expiry_date: '2026-01-01' }] }, // b1 update
      7: { rows: [{ quantity_remaining: '5.000' }] }, // b2 lock
      8: { rows: [{ lot_number: 'L2', expiry_date: '2026-06-01' }] }, // b2 update
      9: { rows: [] }, // UPDATE order_items batch_id
    })
    await deductOrderStock('ord-1', {}, client)
    // Two batch deductions: 1.0 from b1, 1.5 from b2
    expect(logStockMovement).toHaveBeenCalledWith(client, expect.objectContaining({ batchId: 'b1', quantityChange: -1 }))
    expect(logStockMovement).toHaveBeenCalledWith(client, expect.objectContaining({ batchId: 'b2', quantityChange: -1.5 }))
    // order_item tagged with first (nearest-expiry) batch
    const tag = client.calls.find((c: any) => /UPDATE order_items SET batch_id/.test(c.sql))
    expect(tag.params).toEqual(['b1', 'oi1'])
    expect(syncPerishableStock).toHaveBeenCalledWith(client, 'p1', null, null)
  })

  it('throws when batches cannot cover the quantity', async () => {
    const client = makeClient({
      0: { rows: [] },
      1: { rows: [{ id: 'oi1', product_id: 'p1', variant_id: null, sub_variant_id: null, product_name: 'Cable', variant_name: null, quantity: '10', buy_unit: 'm' }] },
      2: { rows: [{ unit: 'm', factor: '1', dimension: 'length', qty_step: '0.5', min_qty: '0.5', max_qty: null }] },
      3: { rows: [{ perishable: true, serialized: false }] },
      4: { rows: [{ id: 'b1', quantity_remaining: '2.000' }] }, // only 2 available, need 10
    })
    await expect(deductOrderStock('ord-1', {}, client)).rejects.toThrow(/Insufficient batch stock/i)
  })
})

describe('deductOrderStock — serialized (1 serial per qty_step)', () => {
  it('marks N serials sold where N = qty / qty_step', async () => {
    // 10 m with qty_step 5 → 2 serials.
    const client = makeClient({
      0: { rows: [] }, // guard
      1: { rows: [{ id: 'oi1', product_id: 'p1', variant_id: null, sub_variant_id: null, product_name: 'Drum', variant_name: null, quantity: '10', buy_unit: 'm' }] },
      2: { rows: [{ unit: 'm', factor: '1', dimension: 'length', qty_step: '5', min_qty: '5', max_qty: null }] },
      3: { rows: [{ perishable: false, serialized: true }] },
      4: { rows: [ { id: 's1', serial_number: 'SN-1', batch_id: 'b1' }, { id: 's2', serial_number: 'SN-2', batch_id: 'b1' } ] }, // FEFO serial pick, LIMIT 2
      5: { rows: [] }, // UPDATE serial s1 sold
      6: { rows: [{ lot_number: 'L1', expiry_date: null }] }, // batch dec for s1
      7: { rows: [] }, // UPDATE serial s2 sold
      8: { rows: [{ lot_number: 'L1', expiry_date: null }] }, // batch dec for s2
      9: { rows: [] }, // UPDATE order_items batch_id
    })
    await deductOrderStock('ord-1', {}, client)
    expect(logStockMovement).toHaveBeenCalledWith(client, expect.objectContaining({ serialNumber: 'SN-1', quantityChange: -1 }))
    expect(logStockMovement).toHaveBeenCalledWith(client, expect.objectContaining({ serialNumber: 'SN-2', quantityChange: -1 }))
    // exactly 2 serials sold
    const sold = client.calls.filter((c: any) => /UPDATE product_serials SET status = 'sold'/.test(c.sql))
    expect(sold).toHaveLength(2)
  })

  it('throws when not enough in-stock serials', async () => {
    const client = makeClient({
      0: { rows: [] },
      1: { rows: [{ id: 'oi1', product_id: 'p1', variant_id: null, sub_variant_id: null, product_name: 'Drum', variant_name: null, quantity: '10', buy_unit: 'm' }] },
      2: { rows: [{ unit: 'm', factor: '1', dimension: 'length', qty_step: '5', min_qty: '5', max_qty: null }] },
      3: { rows: [{ perishable: false, serialized: true }] },
      4: { rows: [{ id: 's1', serial_number: 'SN-1', batch_id: 'b1' }] }, // only 1, need 2
    })
    await expect(deductOrderStock('ord-1', {}, client)).rejects.toThrow(/Not enough serial units/i)
  })
})

describe('deductOrderStock — manual assignments (admin picker popup)', () => {
  it('respects explicit batch assignments instead of auto-FEFO', async () => {
    const client = makeClient({
      0: { rows: [] },
      1: { rows: [{ id: 'oi1', product_id: 'p1', variant_id: null, sub_variant_id: null, product_name: 'Cable', variant_name: null, quantity: '3', buy_unit: 'm' }] },
      2: { rows: [{ unit: 'm', factor: '1', dimension: 'length', qty_step: '1', min_qty: '1', max_qty: null }] },
      3: { rows: [{ perishable: true, serialized: false }] },
      // NO auto-FEFO list query — manual plan used. Next is the batch lock:
      4: { rows: [{ quantity_remaining: '5.000' }] }, // manual batch lock
      5: { rows: [{ lot_number: 'LX', expiry_date: '2026-03-01' }] }, // manual batch update
      6: { rows: [] }, // UPDATE order_items batch_id
    })
    await deductOrderStock('ord-1', { batchAssignments: [{ order_item_id: 'oi1', batch_id: 'bX', qty: 3 }] }, client)
    expect(logStockMovement).toHaveBeenCalledWith(client, expect.objectContaining({ batchId: 'bX', quantityChange: -3 }))
    // No auto-FEFO SELECT of the available batch list
    const fefo = client.calls.find((c: any) => /quantity_remaining > 0/.test(c.sql))
    expect(fefo).toBeUndefined()
  })
})
