import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@jeffi/tenancy', () => ({
  query: vi.fn(),
  queryMany: vi.fn(),
  queryOne: vi.fn(),
  getClient: vi.fn(),
}))

vi.mock('../../src/lib/inventory.js', () => ({
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
  getStockForProduct,
  syncCentralInventory,
  adjustStock,
  moveStock,
  decrementNonPerishableShelfStock,
  upsertShelfStock,
} from '../../src/lib/shelf.js'
import { query, queryMany, queryOne, getClient } from '@jeffi/tenancy'

const mockQuery = vi.mocked(query)
const mockQueryMany = vi.mocked(queryMany)
const mockQueryOne = vi.mocked(queryOne)
const mockGetClient = vi.mocked(getClient)

beforeEach(() => {
  vi.resetAllMocks()
})

// Fake transaction client for getClient-based functions. `calls` is a live view
// over query.mock.calls so it stays correct even when a test overrides the
// implementation via client.query.mockImplementation(...).
function fakeClient() {
  const query = vi.fn(async () => ({ rows: [], rowCount: 0 }))
  const release = vi.fn()
  return {
    query,
    release,
    get calls(): { sql: string; params?: any[] }[] {
      return query.mock.calls.map(([sql, params]: any[]) => ({ sql, params }))
    },
  }
}

// ── Warehouse CRUD ────────────────────────────────────────────────────────
describe('warehouse CRUD', () => {
  it('listWarehouses selects ordered by name', async () => {
    mockQueryMany.mockResolvedValue([{ id: 'w1', name: 'A' }] as any)
    const r = await listWarehouses()
    expect(r).toEqual([{ id: 'w1', name: 'A' }])
    expect(mockQueryMany).toHaveBeenCalledWith(expect.stringContaining('ORDER BY name ASC'))
  })

  it('getWarehouse passes the id', async () => {
    mockQueryOne.mockResolvedValue({ id: 'w1' } as any)
    expect(await getWarehouse('w1')).toEqual({ id: 'w1' })
    expect(mockQueryOne).toHaveBeenCalledWith(expect.stringContaining('FROM warehouses WHERE id = $1'), ['w1'])
  })

  it('createWarehouse uppercases the code', async () => {
    mockQueryOne.mockResolvedValue({ id: 'w1', code: 'WH1' } as any)
    await createWarehouse('Main', 'wh1', '1 St')
    expect(mockQueryOne).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO warehouses'), ['Main', 'WH1', '1 St'])
  })

  it('createWarehouse throws when insert returns null', async () => {
    mockQueryOne.mockResolvedValue(null as any)
    await expect(createWarehouse('Main', 'wh1')).rejects.toThrow('Insert failed')
  })

  it('updateWarehouse builds the SET list and uppercases code', async () => {
    mockQueryOne.mockResolvedValue({ id: 'w1' } as any)
    await updateWarehouse('w1', { name: 'New', code: 'ab', is_active: false })
    const [sql, params] = mockQueryOne.mock.calls[0]
    expect(sql).toContain('UPDATE warehouses SET')
    expect(params).toEqual(['New', 'AB', false, 'w1'])
  })

  it('updateWarehouse throws when no fields given', async () => {
    await expect(updateWarehouse('w1', {})).rejects.toThrow('No fields to update')
  })

  it('updateWarehouse throws when row not found', async () => {
    mockQueryOne.mockResolvedValue(null as any)
    await expect(updateWarehouse('w1', { name: 'X' })).rejects.toThrow('Warehouse not found')
  })

  it('deleteWarehouse refuses when stock is assigned', async () => {
    mockQueryOne.mockResolvedValue({ c: '3' } as any)
    await expect(deleteWarehouse('w1')).rejects.toThrow('Cannot delete warehouse with stock assigned')
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('deleteWarehouse deletes when no stock', async () => {
    mockQueryOne.mockResolvedValue({ c: '0' } as any)
    mockQuery.mockResolvedValue({ rows: [] } as any)
    await deleteWarehouse('w1')
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM warehouses'), ['w1'])
  })
})

// ── Location CRUD ─────────────────────────────────────────────────────────
describe('location CRUD', () => {
  it('listLocations with warehouse filter passes the id', async () => {
    mockQueryMany.mockResolvedValue([] as any)
    await listLocations('w1')
    const [sql, params] = mockQueryMany.mock.calls[0]
    expect(sql).toContain('WHERE sl.warehouse_id = $1')
    expect(params).toEqual(['w1'])
  })

  it('listLocations without filter uses no params', async () => {
    mockQueryMany.mockResolvedValue([] as any)
    await listLocations()
    expect(mockQueryMany.mock.calls[0][1]).toEqual([])
  })

  it('getOrCreateOpenShelf returns existing id without inserting', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'loc-open' } as any)
    expect(await getOrCreateOpenShelf('w1', 'WH1')).toBe('loc-open')
    expect(mockQueryOne).toHaveBeenCalledOnce()
  })

  it('getOrCreateOpenShelf creates one when none exists', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null as any) // no existing
      .mockResolvedValueOnce({ id: 'loc-new' } as any) // insert
    expect(await getOrCreateOpenShelf('w1', 'WH1')).toBe('loc-new')
    const insertCall = mockQueryOne.mock.calls[1]
    expect(insertCall[0]).toContain('INSERT INTO shelf_locations')
    expect(insertCall[1]).toEqual(['w1', 'WH1-OPEN'])
  })

  it('getLocation passes the id', async () => {
    mockQueryOne.mockResolvedValue({ id: 'loc1' } as any)
    await getLocation('loc1')
    expect(mockQueryOne).toHaveBeenCalledWith(expect.stringContaining('WHERE sl.id = $1'), ['loc1'])
  })

  it('createLocation builds display code and uppercases aisle/shelf', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ code: 'WH1' } as any) // warehouse lookup
      .mockResolvedValueOnce({ id: 'loc1' } as any) // insert
    await createLocation('w1', 'a1', 'R2', 's3', 'b4', 'note')
    const insertCall = mockQueryOne.mock.calls[1]
    // display_code = WH1-A1-R2-S3-b4 ; params order: wh,aisle,rack,shelf,bin,display,notes
    expect(insertCall[1]).toEqual(['w1', 'A1', 'R2', 'S3', 'b4', 'WH1-A1-R2-S3-b4', 'note'])
  })

  it('createLocation throws when warehouse not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null as any)
    await expect(createLocation('w1', 'a', 'r', 's')).rejects.toThrow('Warehouse not found')
  })

  it('updateLocation recomputes display code from current + changed fields', async () => {
    // getLocation (current) then the UPDATE
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'loc1',
        warehouse_code: 'WH1',
        aisle_code: 'A1',
        rack_code: 'R1',
        shelf_code: 'S1',
        bin_code: null,
      } as any)
      .mockResolvedValueOnce({ id: 'loc1' } as any)
    await updateLocation('loc1', { aisle_code: 'a2', is_active: false })
    const upd = mockQueryOne.mock.calls[1]
    expect(upd[0]).toContain('UPDATE shelf_locations SET')
    // new display: WH1-A2-R1-S1 (bin null) ; display_code param is index 4
    expect(upd[1]).toContain('WH1-A2-R1-S1')
    expect(upd[1]).toContain(false)
  })

  it('updateLocation throws when current location missing', async () => {
    mockQueryOne.mockResolvedValueOnce(null as any)
    await expect(updateLocation('loc1', { notes: 'x' })).rejects.toThrow('Location not found')
  })

  it('deleteLocation refuses with stock, deletes without', async () => {
    mockQueryOne.mockResolvedValueOnce({ c: '2' } as any)
    await expect(deleteLocation('loc1')).rejects.toThrow('Cannot delete location with stock assigned')

    mockQueryOne.mockResolvedValueOnce({ c: '0' } as any)
    mockQuery.mockResolvedValue({ rows: [] } as any)
    await deleteLocation('loc1')
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM shelf_locations'), ['loc1'])
  })

  it('getStockForProduct passes nullable variant/sub-variant', async () => {
    mockQueryMany.mockResolvedValue([] as any)
    await getStockForProduct('p1')
    expect(mockQueryMany.mock.calls[0][1]).toEqual(['p1', null, null])
  })
})

// ── syncCentralInventory ──────────────────────────────────────────────────
describe('syncCentralInventory', () => {
  it('product grain: writes the product inventory_quantity from shelf total', async () => {
    const client = fakeClient()
    client.query.mockImplementation(async (sql: string) => {
      if (/SUM\(quantity\)/i.test(sql)) return { rows: [{ total: '42' }] }
      if (/inventory_sync/i.test(sql)) return { rows: [{ inventory_sync: false }] }
      return { rows: [] }
    })
    await syncCentralInventory(client, 'p1', null, null)
    const prodUpd = client.calls.find(c => /UPDATE products SET inventory_quantity = \$1/i.test(c.sql))
    expect(prodUpd?.params).toEqual([42, 'p1'])
  })

  it('variant grain: writes variant then rolls up to product', async () => {
    const client = fakeClient()
    client.query.mockImplementation(async (sql: string) => {
      if (/SUM\(quantity\)/i.test(sql)) return { rows: [{ total: '5' }] }
      return { rows: [] }
    })
    await syncCentralInventory(client, 'p1', 'v1', null)
    expect(client.calls.some(c => /UPDATE product_variants SET inventory_quantity = \$1/i.test(c.sql))).toBe(true)
    expect(client.calls.some(c => /UPDATE products SET inventory_quantity = COALESCE/i.test(c.sql))).toBe(true)
  })

  it('sub-variant grain: writes sub-variant with binary status + cascades up', async () => {
    const client = fakeClient()
    client.query.mockImplementation(async (sql: string) => {
      if (/SUM\(quantity\)/i.test(sql)) return { rows: [{ total: '0' }] }
      return { rows: [] }
    })
    await syncCentralInventory(client, 'p1', 'v1', 'sv1')
    const svUpd = client.calls.find(c => /UPDATE product_sub_variants SET inventory_quantity/i.test(c.sql))
    // total 0 → 'Out of Stock'
    expect(svUpd?.params).toEqual([0, 'Out of Stock', 'sv1'])
  })
})

// ── adjustStock ───────────────────────────────────────────────────────────
describe('adjustStock', () => {
  it('updates an existing row and commits', async () => {
    const client = fakeClient()
    client.query.mockImplementation(async (sql: string) => {
      if (/SELECT id, quantity FROM shelf_stock/i.test(sql)) return { rows: [{ id: 'ss1', quantity: 10 }] }
      if (/SUM\(quantity\)/i.test(sql)) return { rows: [{ total: '15' }] }
      return { rows: [] }
    })
    mockGetClient.mockResolvedValue(client as any)
    mockQueryOne.mockResolvedValue({ id: 'ss1', quantity: 15 } as any) // final SELECT * row
    const r = await adjustStock('loc1', 'p1', null, null, 5, 'manual count')
    // 10 + 5 = 15 → UPDATE
    expect(client.calls.some(c => /UPDATE shelf_stock SET quantity = \$1/i.test(c.sql) && c.params?.[0] === 15)).toBe(true)
    expect(client.calls.some(c => c.sql === 'COMMIT')).toBe(true)
    expect(client.release).toHaveBeenCalled()
    expect(r.quantity).toBe(15)
  })

  it('deletes the row when the adjusted quantity reaches 0 and returns a zero stub', async () => {
    const client = fakeClient()
    client.query.mockImplementation(async (sql: string) => {
      if (/SELECT id, quantity FROM shelf_stock/i.test(sql)) return { rows: [{ id: 'ss1', quantity: 3 }] }
      if (/SUM\(quantity\)/i.test(sql)) return { rows: [{ total: '0' }] }
      return { rows: [] }
    })
    mockGetClient.mockResolvedValue(client as any)
    const r = await adjustStock('loc1', 'p1', null, null, -3, 'depleted')
    expect(client.calls.some(c => /DELETE FROM shelf_stock/i.test(c.sql))).toBe(true)
    expect(r.quantity).toBe(0)
  })

  it('inserts a new row when none exists', async () => {
    const client = fakeClient()
    client.query.mockImplementation(async (sql: string) => {
      if (/SELECT id, quantity FROM shelf_stock/i.test(sql)) return { rows: [] }
      if (/INSERT INTO shelf_stock .*RETURNING/is.test(sql)) return { rows: [{ id: 'new1' }] }
      if (/SUM\(quantity\)/i.test(sql)) return { rows: [{ total: '7' }] }
      return { rows: [] }
    })
    mockGetClient.mockResolvedValue(client as any)
    mockQueryOne.mockResolvedValue({ id: 'new1', quantity: 7 } as any) // final SELECT * row
    const r = await adjustStock('loc1', 'p1', null, null, 7, 'receive')
    expect(client.calls.some(c => /INSERT INTO shelf_stock/i.test(c.sql))).toBe(true)
    expect(r.id).toBe('new1')
  })

  it('rolls back and rethrows on error', async () => {
    const client = fakeClient()
    client.query.mockImplementation(async (sql: string) => {
      if (/SELECT id, quantity FROM shelf_stock/i.test(sql)) throw new Error('boom')
      return { rows: [] }
    })
    mockGetClient.mockResolvedValue(client as any)
    await expect(adjustStock('loc1', 'p1', null, null, 1, 'x')).rejects.toThrow('boom')
    expect(client.calls.some(c => c.sql === 'ROLLBACK')).toBe(true)
    expect(client.release).toHaveBeenCalled()
  })
})

// ── moveStock ─────────────────────────────────────────────────────────────
describe('moveStock', () => {
  it('rejects non-positive qty', async () => {
    await expect(moveStock('a', 'b', 'p1', null, null, 0)).rejects.toThrow('Quantity must be positive')
  })
  it('rejects same source and destination', async () => {
    await expect(moveStock('a', 'a', 'p1', null, null, 5)).rejects.toThrow('Source and destination must differ')
  })

  it('non-perishable: moves shelf_stock, deletes empty source, inserts at destination', async () => {
    const client = fakeClient()
    let fromSeen = 0
    client.query.mockImplementation(async (sql: string, params?: any[]) => {
      if (/SELECT perishable FROM products/i.test(sql)) return { rows: [{ perishable: false }] }
      if (/SELECT id, quantity FROM shelf_stock/i.test(sql)) {
        // first call = from (loc A, qty 5), second = to (none)
        fromSeen++
        return fromSeen === 1 ? { rows: [{ id: 'f1', quantity: 5 }] } : { rows: [] }
      }
      return { rows: [] }
    })
    mockGetClient.mockResolvedValue(client as any)
    await moveStock('A', 'B', 'p1', null, null, 5)
    // moving all 5 of 5 → delete source row
    expect(client.calls.some(c => /DELETE FROM shelf_stock/i.test(c.sql))).toBe(true)
    // destination has no row → INSERT
    expect(client.calls.some(c => /INSERT INTO shelf_stock/i.test(c.sql))).toBe(true)
    expect(client.calls.some(c => c.sql === 'COMMIT')).toBe(true)
  })

  it('non-perishable: throws when source has insufficient stock', async () => {
    const client = fakeClient()
    client.query.mockImplementation(async (sql: string) => {
      if (/SELECT perishable FROM products/i.test(sql)) return { rows: [{ perishable: false }] }
      if (/SELECT id, quantity FROM shelf_stock/i.test(sql)) return { rows: [{ id: 'f1', quantity: 2 }] }
      return { rows: [] }
    })
    mockGetClient.mockResolvedValue(client as any)
    await expect(moveStock('A', 'B', 'p1', null, null, 5)).rejects.toThrow('Insufficient stock at source location')
    expect(client.calls.some(c => c.sql === 'ROLLBACK')).toBe(true)
  })

  it('non-perishable: partial move updates source and increments existing destination', async () => {
    const client = fakeClient()
    let fromSeen = 0
    client.query.mockImplementation(async (sql: string) => {
      if (/SELECT perishable FROM products/i.test(sql)) return { rows: [{ perishable: false }] }
      if (/SELECT id, quantity FROM shelf_stock/i.test(sql)) {
        fromSeen++
        return fromSeen === 1 ? { rows: [{ id: 'f1', quantity: 10 }] } : { rows: [{ id: 't1', quantity: 4 }] }
      }
      return { rows: [] }
    })
    mockGetClient.mockResolvedValue(client as any)
    await moveStock('A', 'B', 'p1', null, null, 3)
    // source 10-3=7 UPDATE, destination 4+3=7 UPDATE
    const updates = client.calls.filter(c => /UPDATE shelf_stock SET quantity = \$1/i.test(c.sql))
    expect(updates.some(c => c.params?.[0] === 7)).toBe(true)
  })
})

// ── decrementNonPerishableShelfStock ──────────────────────────────────────
describe('decrementNonPerishableShelfStock', () => {
  it('no-op when qty <= 0', async () => {
    const client = fakeClient()
    await decrementNonPerishableShelfStock(client, 'p1', null, null, 0)
    expect(client.query).not.toHaveBeenCalled()
  })
  it('runs the decrement on the passed client', async () => {
    const client = fakeClient()
    await decrementNonPerishableShelfStock(client, 'p1', 'v1', null, 4)
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('GREATEST(0, quantity - $1)'), [
      4,
      'p1',
      'v1',
      null,
    ])
  })
  it('opens and releases its own connection when no client passed', async () => {
    const client = fakeClient()
    mockGetClient.mockResolvedValue(client as any)
    await decrementNonPerishableShelfStock(null, 'p1', null, null, 2)
    expect(client.query).toHaveBeenCalledOnce()
    expect(client.release).toHaveBeenCalled()
  })
})

// ── upsertShelfStock ──────────────────────────────────────────────────────
describe('upsertShelfStock', () => {
  it("mode 'add' increments the existing quantity", async () => {
    const client = fakeClient()
    client.query.mockImplementation(async (sql: string) => {
      if (/SELECT id, quantity FROM shelf_stock/i.test(sql)) return { rows: [{ id: 'ss1', quantity: '5' }] }
      return { rows: [] }
    })
    await upsertShelfStock(client, {
      locationId: 'loc1',
      productId: 'p1',
      variantId: null,
      subVariantId: null,
      quantity: 3,
      mode: 'add',
    })
    const upd = client.calls.find(c => /UPDATE shelf_stock SET quantity = \$1/i.test(c.sql))
    expect(upd?.params).toEqual([8, 'ss1']) // 5 + 3
  })

  it("mode 'set' replaces the quantity", async () => {
    const client = fakeClient()
    client.query.mockImplementation(async (sql: string) => {
      if (/SELECT id, quantity FROM shelf_stock/i.test(sql)) return { rows: [{ id: 'ss1', quantity: '5' }] }
      return { rows: [] }
    })
    await upsertShelfStock(client, {
      locationId: 'loc1',
      productId: 'p1',
      variantId: null,
      subVariantId: null,
      quantity: 2,
      mode: 'set',
    })
    const upd = client.calls.find(c => /UPDATE shelf_stock SET quantity = \$1/i.test(c.sql))
    expect(upd?.params).toEqual([2, 'ss1'])
  })

  it('deletes the row when the resulting quantity is <= 0', async () => {
    const client = fakeClient()
    client.query.mockImplementation(async (sql: string) => {
      if (/SELECT id, quantity FROM shelf_stock/i.test(sql)) return { rows: [{ id: 'ss1', quantity: '2' }] }
      return { rows: [] }
    })
    await upsertShelfStock(client, {
      locationId: 'loc1',
      productId: 'p1',
      variantId: null,
      subVariantId: null,
      quantity: -2,
      mode: 'add',
    })
    expect(client.calls.some(c => /DELETE FROM shelf_stock/i.test(c.sql))).toBe(true)
  })

  it('inserts a new row when none exists and quantity > 0', async () => {
    const client = fakeClient()
    client.query.mockImplementation(async (sql: string) => {
      if (/SELECT id, quantity FROM shelf_stock/i.test(sql)) return { rows: [] }
      return { rows: [] }
    })
    await upsertShelfStock(client, {
      locationId: 'loc1',
      productId: 'p1',
      variantId: null,
      subVariantId: null,
      quantity: 6,
      mode: 'set',
    })
    const ins = client.calls.find(c => /INSERT INTO shelf_stock/i.test(c.sql))
    expect(ins?.params).toEqual(['loc1', 'p1', null, null, 6])
  })

  it('coerces a non-finite quantity to 0 (no insert)', async () => {
    const client = fakeClient()
    client.query.mockImplementation(async (sql: string) => {
      if (/SELECT id, quantity FROM shelf_stock/i.test(sql)) return { rows: [] }
      return { rows: [] }
    })
    await upsertShelfStock(client, {
      locationId: 'loc1',
      productId: 'p1',
      variantId: null,
      subVariantId: null,
      quantity: NaN,
      mode: 'set',
    })
    expect(client.calls.some(c => /INSERT INTO shelf_stock/i.test(c.sql))).toBe(false)
  })
})
