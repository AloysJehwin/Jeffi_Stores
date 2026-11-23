import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn().mockResolvedValue(null),
  queryMany: vi.fn().mockResolvedValue([]),
  getClient: vi.fn(),
}))

vi.mock('@/lib/orders/inventory', () => ({
  recomputeStockStatusForProduct: vi.fn().mockResolvedValue(undefined),
}))

import {
  listWarehouses,
  getWarehouse,
  createWarehouse,
  updateWarehouse,
  deleteWarehouse,
  listLocations,
  getOrCreateOpenShelf,
  getLocation,
  createLocation,
  updateLocation,
  deleteLocation,
  getStockAtLocation,
  getBatchesAtLocation,
  getStockForProduct,
  syncCentralInventory,
  syncPerishableStock,
  adjustStock,
  moveStock,
  decrementNonPerishableShelfStock,
  upsertShelfStock,
} from '@/lib/catalog/shelf'
import { query, queryOne, queryMany, getClient } from '@/lib/shared/db'
import { recomputeStockStatusForProduct } from '@/lib/orders/inventory'

beforeEach(() => {
  vi.mocked(query).mockReset().mockResolvedValue({ rows: [], rowCount: 0 } as any)
  vi.mocked(queryOne).mockReset().mockResolvedValue(null as any)
  vi.mocked(queryMany).mockReset().mockResolvedValue([] as any)
  vi.mocked(getClient).mockReset()
  vi.mocked(recomputeStockStatusForProduct).mockReset().mockResolvedValue(undefined as any)
})

// Transaction client whose query() is routed by SQL substring/regex, optionally
// narrowed by a params predicate (two textually-identical queries, different args).
function makeTxClient(
  routes: Array<{ match: RegExp | string; rows?: any[]; when?: (params: any[]) => boolean }> = []
) {
  const calls: { sql: string; params: any[] }[] = []
  const query = vi.fn(async (sql: string, params: any[] = []) => {
    calls.push({ sql, params })
    for (const r of routes) {
      const hit = typeof r.match === 'string' ? sql.includes(r.match) : r.match.test(sql)
      if (hit && (!r.when || r.when(params))) return { rows: r.rows ?? [] }
    }
    return { rows: [] }
  })
  const release = vi.fn()
  return { client: { query, release } as any, calls, release }
}

describe('warehouse reads', () => {
  it('listWarehouses selects ordered by name', async () => {
    vi.mocked(queryMany).mockResolvedValue([{ id: 'w1' }] as any)
    expect(await listWarehouses()).toEqual([{ id: 'w1' }])
    expect(String(vi.mocked(queryMany).mock.calls[0][0])).toMatch(/FROM warehouses ORDER BY name ASC/)
  })

  it('getWarehouse passes the id', async () => {
    vi.mocked(queryOne).mockResolvedValue({ id: 'w1' } as any)
    expect(await getWarehouse('w1')).toEqual({ id: 'w1' })
    expect(vi.mocked(queryOne).mock.calls[0][1]).toEqual(['w1'])
  })
})

describe('createWarehouse', () => {
  it('uppercases the code and returns the row', async () => {
    vi.mocked(queryOne).mockResolvedValue({ id: 'w1', code: 'RPR' } as any)
    const r = await createWarehouse('Raipur', 'rpr', '  addr')
    expect(r.code).toBe('RPR')
    expect(vi.mocked(queryOne).mock.calls[0][1]).toEqual(['Raipur', 'RPR', '  addr'])
  })

  it('defaults address to null and throws when insert returns nothing', async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any)
    await expect(createWarehouse('N', 'c')).rejects.toThrow('Insert failed')
    expect(vi.mocked(queryOne).mock.calls[0][1]).toEqual(['N', 'C', null])
  })
})

describe('updateWarehouse', () => {
  it('builds SET only for provided fields, uppercasing code, id last', async () => {
    vi.mocked(queryOne).mockResolvedValue({ id: 'w1' } as any)
    await updateWarehouse('w1', { name: 'X', code: 'ab', is_active: false })
    const [sql, params] = vi.mocked(queryOne).mock.calls[0]
    expect(String(sql)).toMatch(/SET name = \$1, code = \$2, is_active = \$3 WHERE id = \$4/)
    expect(params).toEqual(['X', 'AB', false, 'w1'])
  })

  it('includes address when provided', async () => {
    vi.mocked(queryOne).mockResolvedValue({ id: 'w1' } as any)
    await updateWarehouse('w1', { address: 'here' })
    expect(vi.mocked(queryOne).mock.calls[0][1]).toEqual(['here', 'w1'])
  })

  it('throws when no fields given', async () => {
    await expect(updateWarehouse('w1', {})).rejects.toThrow('No fields to update')
  })

  it('throws when the row is not found', async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any)
    await expect(updateWarehouse('w1', { name: 'X' })).rejects.toThrow('Warehouse not found')
  })
})

describe('deleteWarehouse', () => {
  it('blocks deletion when stock is assigned', async () => {
    vi.mocked(queryOne).mockResolvedValue({ c: '3' } as any)
    await expect(deleteWarehouse('w1')).rejects.toThrow('Cannot delete warehouse with stock assigned')
    expect(vi.mocked(query)).not.toHaveBeenCalled()
  })

  it('deletes when no stock', async () => {
    vi.mocked(queryOne).mockResolvedValue({ c: '0' } as any)
    await deleteWarehouse('w1')
    expect(String(vi.mocked(query).mock.calls[0][0])).toContain('DELETE FROM warehouses WHERE id = $1')
    expect(vi.mocked(query).mock.calls[0][1]).toEqual(['w1'])
  })
})

describe('listLocations', () => {
  it('adds a WHERE + param when scoped to a warehouse', async () => {
    await listLocations('w1')
    const [sql, params] = vi.mocked(queryMany).mock.calls[0]
    expect(String(sql)).toContain('WHERE sl.warehouse_id = $1')
    expect(params).toEqual(['w1'])
  })

  it('omits the WHERE when unscoped', async () => {
    await listLocations()
    const [sql, params] = vi.mocked(queryMany).mock.calls[0]
    expect(String(sql)).not.toContain('WHERE sl.warehouse_id')
    expect(params).toEqual([])
  })
})

describe('getOrCreateOpenShelf', () => {
  it('returns the existing open shelf id', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ id: 'loc-1' } as any)
    expect(await getOrCreateOpenShelf('w1', 'RPR')).toBe('loc-1')
    expect(vi.mocked(queryOne)).toHaveBeenCalledTimes(1)
  })

  it('creates one when missing, naming it <code>-OPEN', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null as any).mockResolvedValueOnce({ id: 'loc-new' } as any)
    expect(await getOrCreateOpenShelf('w1', 'RPR')).toBe('loc-new')
    expect(vi.mocked(queryOne).mock.calls[1][1]).toEqual(['w1', 'RPR-OPEN'])
  })
})

describe('createLocation', () => {
  it('throws when the warehouse does not exist', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null as any)
    await expect(createLocation('w1', 'a', 'r', 's')).rejects.toThrow('Warehouse not found')
  })

  it('uppercases aisle/shelf and builds the display code', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ code: 'RPR' } as any)
      .mockResolvedValueOnce({ id: 'loc-1' } as any)
    await createLocation('w1', 'a1', 'r1', 's1', 'b1', 'note')
    const params = vi.mocked(queryOne).mock.calls[1][1] as any[]
    // warehouseId, aisle↑, rack(as-is), shelf↑, bin, display, notes
    expect(params[1]).toBe('A1')
    expect(params[2]).toBe('r1')
    expect(params[3]).toBe('S1')
    expect(params[4]).toBe('b1')
    expect(params[5]).toBe('RPR-A1-r1-S1-b1')
    expect(params[6]).toBe('note')
  })

  it('throws when the insert returns nothing', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ code: 'RPR' } as any).mockResolvedValueOnce(null as any)
    await expect(createLocation('w1', 'a', 'r', 's')).rejects.toThrow('Insert failed')
  })
})

describe('updateLocation', () => {
  const current = {
    id: 'loc-1',
    warehouse_code: 'RPR',
    aisle_code: 'A1',
    rack_code: 'R1',
    shelf_code: 'S1',
    bin_code: 'B1',
  }

  it('throws when the location is missing', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null as any) // getLocation
    await expect(updateLocation('loc-1', { notes: 'x' })).rejects.toThrow('Location not found')
  })

  it('recomputes display code from merged fields and writes notes/is_active when present', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce(current as any) // getLocation
      .mockResolvedValueOnce({ id: 'loc-1' } as any) // UPDATE
    await updateLocation('loc-1', { aisle_code: 'a2', notes: 'n', is_active: false })
    const [sql, params] = vi.mocked(queryOne).mock.calls[1]
    expect(String(sql)).toContain('UPDATE shelf_locations SET')
    // aisle↑, rack, shelf↑, bin, display, notes, is_active, id
    expect(params).toEqual(['A2', 'R1', 'S1', 'B1', 'RPR-A2-R1-S1-B1', 'n', false, 'loc-1'])
  })

  it('clears bin_code when passed explicitly as null', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(current as any).mockResolvedValueOnce({ id: 'loc-1' } as any)
    await updateLocation('loc-1', { bin_code: null })
    const params = vi.mocked(queryOne).mock.calls[1][1] as any[]
    expect(params[3]).toBeNull()
    expect(params[4]).toBe('RPR-A1-R1-S1') // no bin segment
  })

  it('throws when the UPDATE returns nothing', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(current as any).mockResolvedValueOnce(null as any)
    await expect(updateLocation('loc-1', { notes: 'x' })).rejects.toThrow('Location not found')
  })
})

describe('deleteLocation', () => {
  it('blocks when stock assigned', async () => {
    vi.mocked(queryOne).mockResolvedValue({ c: '1' } as any)
    await expect(deleteLocation('loc-1')).rejects.toThrow('Cannot delete location with stock assigned')
  })
  it('deletes when empty', async () => {
    vi.mocked(queryOne).mockResolvedValue({ c: '0' } as any)
    await deleteLocation('loc-1')
    expect(String(vi.mocked(query).mock.calls[0][0])).toContain('DELETE FROM shelf_locations WHERE id = $1')
  })
})

describe('location reads', () => {
  it('getStockAtLocation passes locationId and selects the batch-aware quantity', async () => {
    await getStockAtLocation('loc-1')
    const [sql, params] = vi.mocked(queryMany).mock.calls[0]
    expect(String(sql)).toContain('FROM shelf_stock ss')
    expect(String(sql)).toContain('p.perishable OR p.serialized')
    expect(params).toEqual(['loc-1'])
  })

  it('getBatchesAtLocation filters positive remaining and orders by expiry', async () => {
    await getBatchesAtLocation('loc-1')
    const [sql] = vi.mocked(queryMany).mock.calls[0]
    expect(String(sql)).toContain('pb.quantity_remaining > 0')
    expect(String(sql)).toContain('ORDER BY pb.expiry_date ASC NULLS LAST')
  })

  it('getStockForProduct passes nullable variant/sub params', async () => {
    await getStockForProduct('p1')
    expect(vi.mocked(queryMany).mock.calls[0][1]).toEqual(['p1', null, null])
    await getStockForProduct('p1', 'v1', 'sv1')
    expect(vi.mocked(queryMany).mock.calls[1][1]).toEqual(['p1', 'v1', 'sv1'])
  })
})

describe('syncCentralInventory', () => {
  it('product grain: writes product inventory then recomputes status', async () => {
    const { client, calls } = makeTxClient([{ match: 'SUM(quantity)', rows: [{ total: '12' }] }])
    await syncCentralInventory(client, 'p1', null, null)
    expect(calls.some(c => c.sql.includes('UPDATE products SET inventory_quantity = $1'))).toBe(true)
    expect(vi.mocked(recomputeStockStatusForProduct)).toHaveBeenCalledWith(client, 'p1')
  })

  it('variant grain: writes the variant then rolls the product up', async () => {
    const { client, calls } = makeTxClient([{ match: 'SUM(quantity)', rows: [{ total: '5' }] }])
    await syncCentralInventory(client, 'p1', 'v1', null)
    expect(calls.some(c => c.sql.includes('UPDATE product_variants SET inventory_quantity = $1'))).toBe(true)
    expect(calls.some(c => c.sql.includes('SUM(inventory_quantity) FROM product_variants'))).toBe(true)
  })

  it('sub-variant grain: writes binary status inline and cascades to variant + product', async () => {
    const { client, calls } = makeTxClient([{ match: 'SUM(quantity)', rows: [{ total: '0' }] }])
    await syncCentralInventory(client, 'p1', 'v1', 'sv1')
    const svUpdate = calls.find(c => c.sql.includes('UPDATE product_sub_variants SET inventory_quantity'))
    expect(svUpdate!.params).toEqual([0, 'Out of Stock', 'sv1'])
    expect(calls.some(c => c.sql.includes('SUM(sv.inventory_quantity) FROM product_sub_variants'))).toBe(true)
    expect(calls.some(c => c.sql.includes('UPDATE products SET inventory_quantity'))).toBe(true)
  })

  it('sub-variant grain without a variant skips the variant rollup', async () => {
    const { client, calls } = makeTxClient([{ match: 'SUM(quantity)', rows: [{ total: '7' }] }])
    await syncCentralInventory(client, 'p1', null, 'sv1')
    expect(calls.some(c => c.sql.includes('UPDATE product_variants pv SET'))).toBe(false)
    const svUpdate = calls.find(c => c.sql.includes('UPDATE product_sub_variants SET inventory_quantity'))
    expect(svUpdate!.params).toEqual([7, 'In Stock', 'sv1'])
  })
})

describe('decrementNonPerishableShelfStock', () => {
  it('no-ops on non-positive qty', async () => {
    const { client } = makeTxClient()
    await decrementNonPerishableShelfStock(client, 'p1', null, null, 0)
    expect(client.query).not.toHaveBeenCalled()
  })

  it('decrements using GREATEST on the given tx client', async () => {
    const { client, calls } = makeTxClient()
    await decrementNonPerishableShelfStock(client, 'p1', 'v1', null, 3)
    expect(String(calls[0].sql)).toContain('GREATEST(0, quantity - $1)')
    expect(calls[0].params).toEqual([3, 'p1', 'v1', null])
  })

  it('opens and releases its own client when none passed', async () => {
    const { client, release } = makeTxClient()
    vi.mocked(getClient).mockResolvedValue(client)
    await decrementNonPerishableShelfStock(null, 'p1', null, null, 2)
    expect(vi.mocked(getClient)).toHaveBeenCalled()
    expect(release).toHaveBeenCalled()
  })
})

describe('upsertShelfStock', () => {
  it("'add' increments the existing row", async () => {
    const { client, calls } = makeTxClient([{ match: 'SELECT id, quantity FROM shelf_stock', rows: [{ id: 's1', quantity: '4' }] }])
    await upsertShelfStock(client, {
      locationId: 'l', productId: 'p', variantId: null, subVariantId: null, quantity: 3, mode: 'add',
    })
    const upd = calls.find(c => c.sql.includes('UPDATE shelf_stock SET quantity = $1'))
    expect(upd!.params).toEqual([7, 's1'])
  })

  it("'set' replaces, and a non-positive result deletes the row", async () => {
    const { client, calls } = makeTxClient([{ match: 'SELECT id, quantity FROM shelf_stock', rows: [{ id: 's1', quantity: '4' }] }])
    await upsertShelfStock(client, {
      locationId: 'l', productId: 'p', variantId: null, subVariantId: null, quantity: 0, mode: 'set',
    })
    expect(calls.some(c => c.sql.includes('DELETE FROM shelf_stock WHERE id = $1'))).toBe(true)
  })

  it('inserts when there is no row and quantity is positive', async () => {
    const { client, calls } = makeTxClient([{ match: 'SELECT id, quantity FROM shelf_stock', rows: [] }])
    await upsertShelfStock(client, {
      locationId: 'l', productId: 'p', variantId: 'v', subVariantId: null, quantity: 5, mode: 'add',
    })
    const ins = calls.find(c => c.sql.includes('INSERT INTO shelf_stock'))
    expect(ins!.params).toEqual(['l', 'p', 'v', null, 5])
  })

  it('coerces a non-finite quantity to 0 (no insert)', async () => {
    const { client, calls } = makeTxClient([{ match: 'SELECT id, quantity FROM shelf_stock', rows: [] }])
    await upsertShelfStock(client, {
      locationId: 'l', productId: 'p', variantId: null, subVariantId: null, quantity: NaN, mode: 'set',
    })
    expect(calls.some(c => c.sql.includes('INSERT INTO shelf_stock'))).toBe(false)
  })
})

describe('adjustStock', () => {
  it('increments an existing row, logs a transaction, syncs, and returns the row', async () => {
    const { client, calls, release } = makeTxClient([
      { match: /SELECT id, quantity FROM shelf_stock\s+WHERE location_id/, rows: [{ id: 's1', quantity: 5 }] },
      { match: 'SUM(quantity)', rows: [{ total: '8' }] },
    ])
    vi.mocked(getClient).mockResolvedValue(client)
    vi.mocked(queryOne).mockResolvedValue({ id: 's1', quantity: 8 } as any)
    const row = await adjustStock('l', 'p', null, null, 3, 'recount', 'user-1')
    expect(row).toEqual({ id: 's1', quantity: 8 })
    expect(calls.some(c => c.sql === 'BEGIN')).toBe(true)
    expect(calls.some(c => c.sql === 'COMMIT')).toBe(true)
    const txLog = calls.find(c => c.sql.includes('INSERT INTO shelf_stock_transactions'))
    expect(txLog!.params).toEqual(['l', 'p', null, null, 3, 8, 'recount', 'user-1'])
    expect(release).toHaveBeenCalled()
  })

  it('deletes the row and returns a zero-quantity stub when it hits 0', async () => {
    const { client } = makeTxClient([
      { match: /SELECT id, quantity FROM shelf_stock\s+WHERE location_id/, rows: [{ id: 's1', quantity: 2 }] },
      { match: 'SUM(quantity)', rows: [{ total: '0' }] },
    ])
    vi.mocked(getClient).mockResolvedValue(client)
    const row = await adjustStock('l', 'p', null, null, -5, 'sold')
    expect(row.quantity).toBe(0)
    expect(row.id).toBe('s1')
  })

  it('inserts a new row when none exists', async () => {
    const { client, calls } = makeTxClient([
      { match: /SELECT id, quantity FROM shelf_stock\s+WHERE location_id/, rows: [] },
      { match: 'INSERT INTO shelf_stock ', rows: [{ id: 'new' }] },
      { match: 'SUM(quantity)', rows: [{ total: '4' }] },
    ])
    vi.mocked(getClient).mockResolvedValue(client)
    vi.mocked(queryOne).mockResolvedValue({ id: 'new', quantity: 4 } as any)
    const row = await adjustStock('l', 'p', null, null, 4, 'intake')
    expect(row).toEqual({ id: 'new', quantity: 4 })
    expect(calls.some(c => c.sql.includes('INSERT INTO shelf_stock '))).toBe(true)
  })

  it('rolls back and rethrows on error', async () => {
    const boom = new Error('db down')
    const query = vi.fn(async (sql: string) => {
      if (sql === 'BEGIN') return { rows: [] }
      if (sql.includes('SELECT id, quantity FROM shelf_stock')) throw boom
      return { rows: [] }
    })
    const release = vi.fn()
    vi.mocked(getClient).mockResolvedValue({ query, release } as any)
    await expect(adjustStock('l', 'p', null, null, 1, 'x')).rejects.toThrow('db down')
    expect(query).toHaveBeenCalledWith('ROLLBACK')
    expect(release).toHaveBeenCalled()
  })
})

describe('moveStock guards', () => {
  it('rejects a non-positive quantity', async () => {
    await expect(moveStock('a', 'b', 'p', null, null, 0)).rejects.toThrow('Quantity must be positive')
  })
  it('rejects same source and destination', async () => {
    await expect(moveStock('a', 'a', 'p', null, null, 1)).rejects.toThrow('Source and destination must differ')
  })
})

describe('moveStock — non-perishable', () => {
  it('moves shelf_stock from source to destination and logs both legs', async () => {
    const { client, calls } = makeTxClient([
      { match: 'SELECT perishable FROM products', rows: [{ perishable: false }] },
      // fromRow has location_id param 'from'; toRow has 'to' (empty -> insert at dest)
      {
        match: /SELECT id, quantity FROM shelf_stock\s+WHERE location_id = \$1/,
        when: p => p[0] === 'from',
        rows: [{ id: 'from', quantity: 10 }],
      },
    ])
    vi.mocked(getClient).mockResolvedValue(client)
    await moveStock('from', 'to', 'p', null, null, 4, 'user-1')
    const outLog = calls.find(c => c.sql.includes("'move_out'"))
    expect(outLog!.params).toEqual(['from', 'p', null, null, -4, 6, 'user-1'])
    const inLog = calls.find(c => c.sql.includes("'move_in'"))
    expect(inLog!.params).toEqual(['to', 'p', null, null, 4, 4, 'user-1'])
    expect(calls.some(c => c.sql === 'COMMIT')).toBe(true)
  })

  it('throws when source lacks enough stock', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === 'BEGIN') return { rows: [] }
      if (sql.includes('SELECT perishable')) return { rows: [{ perishable: false }] }
      if (sql.includes('SELECT id, quantity FROM shelf_stock')) return { rows: [{ id: 'from', quantity: 1 }] }
      return { rows: [] }
    })
    const release = vi.fn()
    vi.mocked(getClient).mockResolvedValue({ query, release } as any)
    await expect(moveStock('from', 'to', 'p', null, null, 5)).rejects.toThrow('Insufficient stock at source location')
    expect(query).toHaveBeenCalledWith('ROLLBACK')
  })
})

describe('moveStock — perishable', () => {
  it('moves whole and split batches FIFO then resyncs', async () => {
    // getClient is called twice: once by moveStock, once inside syncPerishableStock (clientIn passed, so not opened there).
    const { client, calls } = makeTxClient([
      { match: 'SELECT perishable FROM products', rows: [{ perishable: true }] },
      { match: 'FROM product_batches', rows: [
        { id: 'b1', quantity_remaining: '3' },
        { id: 'b2', quantity_remaining: '10' },
      ] },
      // syncPerishableStock queries (batchTotals, existing) default to []; its
      // nested syncCentralInventory needs a SUM(quantity) total row.
      { match: 'COALESCE(SUM(quantity), 0)::numeric AS total', rows: [{ total: '8' }] },
    ])
    vi.mocked(getClient).mockResolvedValue(client)
    await moveStock('from', 'to', 'p', null, null, 5, 'user-1')
    // b1 fully moved (take 3 == avail), b2 split (take 2)
    const whole = calls.find(c => c.sql.includes('UPDATE product_batches SET location_id = $1'))
    expect(whole!.params).toEqual(['to', 'b1'])
    const reduce = calls.find(c => c.sql.includes('quantity_remaining = quantity_remaining - $1'))
    expect(reduce!.params).toEqual([2, 'b2'])
    expect(calls.some(c => c.sql.includes('INSERT INTO product_batches'))).toBe(true)
    const outLog = calls.find(c => c.sql.includes("'move_out'"))
    expect(outLog!.params).toEqual(['from', 'p', null, null, -5, 8, 'user-1']) // 13 avail - 5
  })

  it('throws when batches do not cover the quantity', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === 'BEGIN') return { rows: [] }
      if (sql.includes('SELECT perishable')) return { rows: [{ perishable: true }] }
      if (sql.includes('FROM product_batches')) return { rows: [{ id: 'b1', quantity_remaining: '2' }] }
      return { rows: [] }
    })
    const release = vi.fn()
    vi.mocked(getClient).mockResolvedValue({ query, release } as any)
    await expect(moveStock('from', 'to', 'p', null, null, 5)).rejects.toThrow('Insufficient stock at source location')
  })
})

describe('syncPerishableStock', () => {
  it('updates, inserts and deletes shelf_stock rows from batch totals (own client)', async () => {
    const { client, calls, release } = makeTxClient([
      { match: 'SELECT location_id, COALESCE(SUM(quantity_remaining)', rows: [
        { location_id: 'locA', total: '5' }, // existing -> update
        { location_id: 'locB', total: '0' }, // existing -> delete
        { location_id: 'locC', total: '9' }, // new -> insert
        { location_id: null, total: '3' },   // skipped
      ] },
      { match: /SELECT id, location_id FROM shelf_stock/, rows: [
        { id: 'sA', location_id: 'locA' },
        { id: 'sB', location_id: 'locB' },
        { id: 'sStale', location_id: 'locStale' }, // not in batches -> deleted at the end
      ] },
      { match: 'SUM(quantity)', rows: [{ total: '14' }] }, // syncCentralInventory
    ])
    vi.mocked(getClient).mockResolvedValue(client)
    await syncPerishableStock(null, 'p', null, null)
    expect(calls.some(c => c.sql.includes('UPDATE shelf_stock SET quantity = $1') && (c.params as any[])[1] === 'sA')).toBe(true)
    expect(calls.some(c => c.sql.includes('DELETE FROM shelf_stock WHERE id = $1') && (c.params as any[])[0] === 'sB')).toBe(true)
    expect(calls.some(c => c.sql.includes('INSERT INTO shelf_stock') && (c.params as any[])[0] === 'locC')).toBe(true)
    expect(calls.some(c => c.sql.includes('DELETE FROM shelf_stock WHERE id = $1') && (c.params as any[])[0] === 'sStale')).toBe(true)
    expect(calls.some(c => c.sql === 'BEGIN')).toBe(true)
    expect(calls.some(c => c.sql === 'COMMIT')).toBe(true)
    expect(release).toHaveBeenCalled()
  })

  it('uses the passed-in client without opening/committing its own', async () => {
    const { client, calls } = makeTxClient([
      { match: 'SELECT location_id, COALESCE(SUM(quantity_remaining)', rows: [] },
      { match: /SELECT id, location_id FROM shelf_stock/, rows: [] },
      { match: 'SUM(quantity)', rows: [{ total: '0' }] },
    ])
    await syncPerishableStock(client, 'p', null, null)
    expect(calls.some(c => c.sql === 'BEGIN')).toBe(false)
    expect(calls.some(c => c.sql === 'COMMIT')).toBe(false)
  })

  it('rolls back on error when it owns the client', async () => {
    const boom = new Error('boom')
    const query = vi.fn(async (sql: string) => {
      if (sql === 'BEGIN') return { rows: [] }
      if (sql.includes('SUM(quantity_remaining)')) throw boom
      return { rows: [] }
    })
    const release = vi.fn()
    vi.mocked(getClient).mockResolvedValue({ query, release } as any)
    await expect(syncPerishableStock(null, 'p', null, null)).rejects.toThrow('boom')
    expect(query).toHaveBeenCalledWith('ROLLBACK')
    expect(release).toHaveBeenCalled()
  })
})
