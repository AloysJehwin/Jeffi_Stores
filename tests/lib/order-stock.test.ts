import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({ withTransaction: vi.fn() }))
vi.mock('@/lib/inventory', () => ({
  logStockMovement: vi.fn().mockResolvedValue(undefined),
  recomputeStockStatusForProduct: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/shelf', () => ({ syncPerishableStock: vi.fn().mockResolvedValue(undefined) }))

import { restoreOrderStock } from '@/lib/order-stock'
import { withTransaction } from '@/lib/db'
import { logStockMovement } from '@/lib/inventory'
import { syncPerishableStock } from '@/lib/shelf'

type Route = (sql: string, params: any[]) => any
const PLAIN = { rows: [{ perishable: false, serialized: false }] }
const TRACKED = { rows: [{ perishable: true, serialized: true }] }
const item = (over: Record<string, unknown> = {}) => ({
  product_id: 'p1',
  variant_id: null,
  sub_variant_id: null,
  quantity: '5',
  buy_unit: null,
  ...over,
})

// SQL-routed fake client: responses chosen by statement text, every call recorded.
function makeClient(route: Route) {
  const calls: { sql: string; params: any[] }[] = []
  const client: any = {
    calls,
    query: vi.fn().mockImplementation(async (sql: string, params: any[] = []) => {
      calls.push({ sql, params })
      return route(sql, params) ?? { rows: [] }
    }),
  }
  vi.mocked(withTransaction).mockImplementation(fn => fn(client))
  return client
}
const find = (client: any, re: RegExp) => client.calls.find((c: any) => re.test(c.sql))
const all = (client: any, re: RegExp) => client.calls.filter((c: any) => re.test(c.sql))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('restoreOrderStock', () => {
  it('skips items that are already restored (return transaction exists)', async () => {
    const client = makeClient(sql => {
      if (sql.includes('FROM order_items')) return { rows: [item()] }
      if (sql.includes("transaction_type = 'return'")) return { rows: [{ ok: 1 }] }
      if (sql.includes('SELECT perishable, serialized')) return PLAIN
    })
    await restoreOrderStock('ord-1')
    expect(logStockMovement).not.toHaveBeenCalled()
  })

  it('restores a plain sub-variant line', async () => {
    const client = makeClient(sql => {
      if (sql.includes('FROM order_items'))
        return { rows: [item({ variant_id: 'v1', sub_variant_id: 'sv1', quantity: '3' })] }
      if (sql.includes('SELECT perishable, serialized')) return PLAIN
      if (sql.includes('FROM product_sub_variants WHERE id = $1 FOR UPDATE'))
        return { rows: [{ inventory_quantity: '20', is_active: true }] }
    })
    await restoreOrderStock('ord-1')
    expect(
      find(client, /UPDATE product_sub_variants SET inventory_quantity = inventory_quantity \+ \$1/).params
    ).toEqual([3, 'sv1'])
    expect(logStockMovement).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ subVariantId: 'sv1', transactionType: 'return', quantityChange: 3 })
    )
  })

  it('restores a plain variant line', async () => {
    const client = makeClient(sql => {
      if (sql.includes('FROM order_items')) return { rows: [item({ variant_id: 'v1', quantity: '2' })] }
      if (sql.includes('SELECT perishable, serialized')) return PLAIN
      if (sql.includes('FROM product_variants WHERE id = $1 FOR UPDATE'))
        return { rows: [{ inventory_quantity: '15', is_active: true }] }
    })
    await restoreOrderStock('ord-1')
    expect(find(client, /UPDATE product_variants SET inventory_quantity = inventory_quantity \+ \$1/).params).toEqual([
      2,
      'v1',
    ])
    expect(logStockMovement).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ variantId: 'v1', currentStock: 15 })
    )
  })

  it('restores a plain product line', async () => {
    const client = makeClient(sql => {
      if (sql.includes('FROM order_items')) return { rows: [item({ quantity: '1' })] }
      if (sql.includes('SELECT perishable, serialized')) return PLAIN
      if (sql.includes('FROM products WHERE id = $1 FOR UPDATE')) return { rows: [{ inventory_quantity: '50' }] }
    })
    await restoreOrderStock('ord-1')
    expect(find(client, /UPDATE products SET inventory_quantity = inventory_quantity \+ \$1/).params).toEqual([1, 'p1'])
    expect(logStockMovement).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ productId: 'p1', variantId: null, currentStock: 50 })
    )
  })

  it('applies unit factor when dimension is count', async () => {
    const client = makeClient(sql => {
      if (sql.includes('FROM order_items')) return { rows: [item({ quantity: '2', buy_unit: 'box' })] }
      if (sql.includes('COALESCE(puv.factor, pup.factor)')) return { rows: [{ factor: '10', dimension: 'count' }] }
      if (sql.includes('SELECT perishable, serialized')) return PLAIN
      if (sql.includes('FROM products WHERE id = $1 FOR UPDATE')) return { rows: [{ inventory_quantity: '0' }] }
    })
    await restoreOrderStock('ord-1')
    expect(logStockMovement).toHaveBeenCalledWith(client, expect.objectContaining({ quantityChange: 20 }))
    expect(find(client, /UPDATE shelf_stock/).params[0]).toBe(20)
  })

  it('reports a plain line whose variant is no longer active instead of restoring it', async () => {
    const client = makeClient(sql => {
      if (sql.includes('FROM order_items')) return { rows: [item({ variant_id: 'v1' })] }
      if (sql.includes('SELECT perishable, serialized')) return PLAIN
      if (sql.includes('FROM product_variants WHERE id = $1 FOR UPDATE'))
        return { rows: [{ inventory_quantity: '4', is_active: false }] }
    })
    const { skipped } = await restoreOrderStock('ord-1')
    expect(skipped).toEqual([expect.objectContaining({ variant_id: 'v1', reason: 'variant is no longer active' })])
    expect(find(client, /UPDATE product_variants SET inventory_quantity/)).toBeUndefined()
  })

  it('tracked: restores into the batch the sale consumed', async () => {
    const client = makeClient(sql => {
      if (sql.includes('FROM order_items')) return { rows: [item()] }
      if (sql.includes('SELECT perishable, serialized')) return TRACKED
      if (sql.includes("transaction_type = 'sale'"))
        return {
          rows: [
            {
              id: 't1',
              batch_id: 'b1',
              quantity_change: '-5',
              serial_number: null,
              lot_number: 'L1',
              expiry_date: null,
            },
          ],
        }
      if (sql.includes('AS is_leaf')) return { rows: [{ is_leaf: true }] }
      if (sql.includes('FROM product_batches WHERE id = $1 FOR UPDATE')) return { rows: [{ quantity_remaining: '10' }] }
    })
    await restoreOrderStock('ord-1')
    expect(find(client, /UPDATE product_batches SET quantity_remaining = quantity_remaining \+ \$1/).params).toEqual([
      5,
      'b1',
    ])
    expect(find(client, /INSERT INTO product_batches/)).toBeUndefined()
    expect(logStockMovement).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ transactionType: 'return', quantityChange: 5, batchId: 'b1', currentStock: 10 })
    )
    expect(syncPerishableStock).toHaveBeenCalledWith(client, 'p1', null, null)
  })

  it('tracked: recreates a batch the sale emptied and re-links its serials', async () => {
    const client = makeClient(sql => {
      if (sql.includes('FROM order_items')) return { rows: [item({ quantity: '2' })] }
      if (sql.includes('SELECT perishable, serialized')) return TRACKED
      if (sql.includes("transaction_type = 'sale'"))
        return {
          rows: [
            {
              id: 't1',
              batch_id: null,
              quantity_change: '-1',
              serial_number: 'SN-1',
              lot_number: 'L7',
              expiry_date: '2027-03-01',
            },
            {
              id: 't2',
              batch_id: null,
              quantity_change: '-1',
              serial_number: 'SN-2',
              lot_number: 'L7',
              expiry_date: '2027-03-01',
            },
          ],
        }
      if (sql.includes('AS is_leaf')) return { rows: [{ is_leaf: true }] }
      if (sql.includes('ORDER BY pri')) return { rows: [{ location_id: 'loc-1' }] }
      if (sql.includes('INSERT INTO product_batches')) return { rows: [{ id: 'nb1' }] }
    })
    await restoreOrderStock('ord-1')
    const ins = find(client, /INSERT INTO product_batches/)
    expect(ins.params).toEqual(['p1', null, null, 'L7', '2027-03-01', 2, 'loc-1', expect.stringContaining('ord-1')])
    expect(find(client, /UPDATE product_serials SET batch_id = \$1/).params).toEqual(['nb1', 'ord-1', ['SN-1', 'SN-2']])
    expect(logStockMovement).toHaveBeenCalledTimes(2)
    expect(logStockMovement).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ batchId: 'nb1', serialNumber: 'SN-2', lotNumber: 'L7' })
    )
    expect(find(client, /UPDATE products SET inventory_quantity = inventory_quantity/)).toBeUndefined()
  })

  it('tracked: a grain that no longer holds stock is reported, not restocked', async () => {
    const client = makeClient(sql => {
      if (sql.includes('FROM order_items')) return { rows: [item({ variant_id: 'v1' })] }
      if (sql.includes('SELECT perishable, serialized')) return TRACKED
      if (sql.includes("transaction_type = 'sale'"))
        return {
          rows: [
            {
              id: 't1',
              batch_id: 'b1',
              quantity_change: '-5',
              serial_number: null,
              lot_number: null,
              expiry_date: null,
            },
          ],
        }
      if (sql.includes('AS is_leaf')) return { rows: [{ is_leaf: false }] }
    })
    const { skipped } = await restoreOrderStock('ord-1')
    expect(skipped).toEqual([
      expect.objectContaining({ variant_id: 'v1', reason: expect.stringContaining('no longer holds stock') }),
    ])
    expect(all(client, /product_batches SET|INSERT INTO product_batches/)).toHaveLength(0)
    expect(logStockMovement).not.toHaveBeenCalled()
  })

  it('serials return to stock only at live grains; the rest are marked returned', async () => {
    const client = makeClient(sql => {
      if (sql.includes('FROM order_items')) return { rows: [item()] }
      if (sql.includes('SELECT perishable, serialized')) return PLAIN
      if (sql.includes('FROM products WHERE id = $1 FOR UPDATE')) return { rows: [{ inventory_quantity: '1' }] }
      if (sql.includes("status = 'returned'"))
        return { rows: [{ product_id: 'p1', variant_id: 'v9', sub_variant_id: null }] }
    })
    const { skipped } = await restoreOrderStock('ord-1')
    const revive = find(client, /SET status = 'in_stock'/)
    expect(revive.sql).toContain('ps.sub_variant_id IS NOT NULL THEN EXISTS')
    expect(revive.params).toEqual(['ord-1'])
    expect(find(client, /status = 'returned', returned_at = NOW\(\)/)).toBeDefined()
    expect(skipped).toEqual([
      expect.objectContaining({ variant_id: 'v9', reason: expect.stringContaining('marked returned') }),
    ])
  })

  it('tracked line with no sale movements falls back to the plain restore and still syncs', async () => {
    const client = makeClient(sql => {
      if (sql.includes('FROM order_items')) return { rows: [item({ quantity: '1' })] }
      if (sql.includes('SELECT perishable, serialized')) return { rows: [{ perishable: true, serialized: false }] }
      if (sql.includes('FROM products WHERE id = $1 FOR UPDATE')) return { rows: [{ inventory_quantity: '5' }] }
    })
    await restoreOrderStock('ord-1')
    expect(find(client, /UPDATE products SET inventory_quantity = inventory_quantity/).params).toEqual([1, 'p1'])
    expect(syncPerishableStock).toHaveBeenCalledWith(client, 'p1', null, null)
    expect(find(client, /UPDATE shelf_stock/)).toBeUndefined()
  })

  it('handles empty order_items (no-op)', async () => {
    makeClient(sql => (sql.includes('FROM order_items') ? { rows: [] } : undefined))
    await restoreOrderStock('ord-empty')
    expect(logStockMovement).not.toHaveBeenCalled()
  })
})
