import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({ withTransaction: vi.fn() }))
vi.mock('@/lib/inventory', () => ({ logStockMovement: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/shelf', () => ({ syncPerishableStock: vi.fn().mockResolvedValue(undefined) }))

import { restoreOrderStock } from '@/lib/order-stock'
import { withTransaction } from '@/lib/db'
import { logStockMovement } from '@/lib/inventory'
import { syncPerishableStock } from '@/lib/shelf'

function makeMockClient(queryResponses: Record<number, any> = {}) {
  let idx = 0
  return {
    query: vi.fn().mockImplementation(async () => {
      const resp = queryResponses[idx] ?? { rows: [] }
      idx++
      return resp
    }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('restoreOrderStock', () => {
  it('skips items that are already restored (return transaction exists)', async () => {
    const client = makeMockClient({
      0: { rows: [{ product_id: 'p1', variant_id: null, sub_variant_id: null, quantity: '5', buy_unit: null }] },
      1: { rows: [] }, // unit row
      2: { rows: [{ id: 1 }] }, // alreadyRestored = true
      // perishable check loop
      3: { rows: [{ perishable: false, serialized: false }] },
      // plain shelf restore loop
      4: { rows: [{ perishable: false, serialized: false }] },
      5: { rows: [] }, // unit row for shelf restore
    })
    vi.mocked(withTransaction).mockImplementation(fn => fn(client))
    await restoreOrderStock('ord-1')
    expect(logStockMovement).not.toHaveBeenCalled()
  })

  it('restores via batch movements when batch transactions exist', async () => {
    const client = makeMockClient({
      0: { rows: [{ product_id: 'p1', variant_id: null, sub_variant_id: null, quantity: '5', buy_unit: null }] },
      1: { rows: [] },    // unit row (no factor)
      2: { rows: [] },    // alreadyRestored = false
      3: { rows: [{ batch_id: 'b1', quantity_change: '-5', serial_number: null }] }, // batch movements
      4: { rows: [{ quantity_remaining: '10' }] }, // batch lock
      5: { rows: [{ lot_number: 'L1', expiry_date: null }] }, // batch update
      // serial reset
      6: { rows: [] },
      // perishable sync loop
      7: { rows: [{ perishable: false, serialized: false }] },
      // plain shelf restore
      8: { rows: [{ perishable: false, serialized: false }] },
      9: { rows: [] }, // unit for shelf
    })
    vi.mocked(withTransaction).mockImplementation(fn => fn(client))
    await restoreOrderStock('ord-1')
    expect(logStockMovement).toHaveBeenCalledWith(client, expect.objectContaining({
      transactionType: 'return',
      quantityChange: 5,
      batchId: 'b1',
    }))
  })

  it('restores via sub_variant_id when no batch movements', async () => {
    const client = makeMockClient({
      0: { rows: [{ product_id: 'p1', variant_id: 'v1', sub_variant_id: 'sv1', quantity: '3', buy_unit: null }] },
      1: { rows: [] },    // unit row
      2: { rows: [] },    // not already restored
      3: { rows: [] },    // no batch movements
      4: { rows: [{ inventory_quantity: '20' }] }, // sub_variant lock
      5: { rows: [] },    // sub_variant update
      // logStockMovement call (no batch)
      6: { rows: [] },    // serial reset
      7: { rows: [{ perishable: false, serialized: false }] },
      8: { rows: [{ perishable: false, serialized: false }] },
      9: { rows: [] },
    })
    vi.mocked(withTransaction).mockImplementation(fn => fn(client))
    await restoreOrderStock('ord-1')
    expect(logStockMovement).toHaveBeenCalledWith(client, expect.objectContaining({
      subVariantId: 'sv1',
      transactionType: 'return',
    }))
  })

  it('restores via variant_id when no sub_variant', async () => {
    const client = makeMockClient({
      0: { rows: [{ product_id: 'p1', variant_id: 'v1', sub_variant_id: null, quantity: '2', buy_unit: null }] },
      1: { rows: [] },
      2: { rows: [] },
      3: { rows: [] },
      4: { rows: [{ inventory_quantity: '15' }] },
      5: { rows: [] },
      6: { rows: [] },
      7: { rows: [{ perishable: false, serialized: false }] },
      8: { rows: [{ perishable: false, serialized: false }] },
      9: { rows: [] },
    })
    vi.mocked(withTransaction).mockImplementation(fn => fn(client))
    await restoreOrderStock('ord-1')
    expect(logStockMovement).toHaveBeenCalledWith(client, expect.objectContaining({
      variantId: 'v1',
    }))
  })

  it('restores via product when no variant', async () => {
    const client = makeMockClient({
      0: { rows: [{ product_id: 'p1', variant_id: null, sub_variant_id: null, quantity: '1', buy_unit: null }] },
      1: { rows: [] },
      2: { rows: [] },
      3: { rows: [] },
      4: { rows: [{ inventory_quantity: '50' }] },
      5: { rows: [] },
      6: { rows: [] },
      7: { rows: [{ perishable: false, serialized: false }] },
      8: { rows: [{ perishable: false, serialized: false }] },
      9: { rows: [] },
    })
    vi.mocked(withTransaction).mockImplementation(fn => fn(client))
    await restoreOrderStock('ord-1')
    expect(logStockMovement).toHaveBeenCalledWith(client, expect.objectContaining({
      productId: 'p1',
      variantId: null,
    }))
  })

  it('applies unit factor when dimension is count', async () => {
    const client = makeMockClient({
      0: { rows: [{ product_id: 'p1', variant_id: null, sub_variant_id: null, quantity: '2', buy_unit: 'box' }] },
      1: { rows: [{ factor: '10', dimension: 'count' }] }, // unit factor
      2: { rows: [] },
      3: { rows: [] },
      4: { rows: [{ inventory_quantity: '0' }] },
      5: { rows: [] },
      6: { rows: [] },
      7: { rows: [{ perishable: false, serialized: false }] },
      8: { rows: [{ perishable: false, serialized: false }] },
      9: { rows: [{ factor: '10', dimension: 'count' }] },
    })
    vi.mocked(withTransaction).mockImplementation(fn => fn(client))
    await restoreOrderStock('ord-1')
    expect(logStockMovement).toHaveBeenCalledWith(client, expect.objectContaining({
      quantityChange: 20,
    }))
  })

  it('syncs perishable shelf stock for perishable products', async () => {
    const client = makeMockClient({
      0: { rows: [{ product_id: 'p1', variant_id: null, sub_variant_id: null, quantity: '1', buy_unit: null }] },
      1: { rows: [] },
      2: { rows: [] },
      3: { rows: [] },
      4: { rows: [{ inventory_quantity: '5' }] },
      5: { rows: [] },
      6: { rows: [] },
      7: { rows: [{ perishable: true, serialized: false }] }, // perishable sync loop
      8: { rows: [{ perishable: true, serialized: false }] }, // plain restore loop (skipped)
    })
    vi.mocked(withTransaction).mockImplementation(fn => fn(client))
    await restoreOrderStock('ord-1')
    expect(syncPerishableStock).toHaveBeenCalledWith(client, 'p1', null, null)
  })

  it('handles empty order_items (no-op)', async () => {
    const client = makeMockClient({ 0: { rows: [] } })
    vi.mocked(withTransaction).mockImplementation(fn => fn(client))
    await restoreOrderStock('ord-empty')
    expect(logStockMovement).not.toHaveBeenCalled()
  })
})
