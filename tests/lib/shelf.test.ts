import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
  getClient: vi.fn(),
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
  adjustStock,
  moveStock,
  syncPerishableStock,
  decrementNonPerishableShelfStock,
  upsertShelfStock,
} from '@/lib/shelf'
import { query, queryOne, queryMany, getClient } from '@/lib/db'

const mockQuery = vi.mocked(query)
const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)
const mockGetClient = vi.mocked(getClient)

// ---------------------------------------------------------------------------
// listWarehouses
// ---------------------------------------------------------------------------

describe('listWarehouses', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls queryMany and returns result', async () => {
    const wh = [{ id: 'wh-1', name: 'Main', code: 'MAIN', address: null, is_active: true, created_at: '' }]
    mockQueryMany.mockResolvedValue(wh)
    const result = await listWarehouses()
    expect(result).toEqual(wh)
    expect(mockQueryMany).toHaveBeenCalledWith(expect.stringContaining('warehouses'))
  })

  it('returns empty array when no warehouses', async () => {
    mockQueryMany.mockResolvedValue([])
    expect(await listWarehouses()).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// getWarehouse
// ---------------------------------------------------------------------------

describe('getWarehouse', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns warehouse when found', async () => {
    mockQueryOne.mockResolvedValue({ id: 'wh-1', name: 'Main' } as any)
    const result = await getWarehouse('wh-1')
    expect(result?.id).toBe('wh-1')
  })

  it('returns null when not found', async () => {
    mockQueryOne.mockResolvedValue(null)
    expect(await getWarehouse('missing')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// createWarehouse
// ---------------------------------------------------------------------------

describe('createWarehouse', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns created warehouse and uppercases the code', async () => {
    const wh = { id: 'wh-new', name: 'New Wh', code: 'NW', address: null, is_active: true, created_at: '' }
    mockQueryOne.mockResolvedValue(wh)
    const result = await createWarehouse('New Wh', 'nw')
    expect(result).toEqual(wh)
    expect(mockQueryOne).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining(['NW']))
  })

  it('passes address when provided', async () => {
    const wh = { id: 'wh-2', name: 'WH2', code: 'WH2', address: '123 St', is_active: true, created_at: '' }
    mockQueryOne.mockResolvedValue(wh)
    await createWarehouse('WH2', 'wh2', '123 St')
    expect(mockQueryOne).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining(['123 St']))
  })

  it('passes null address when omitted', async () => {
    const wh = { id: 'wh-3', name: 'WH3', code: 'WH3', address: null, is_active: true, created_at: '' }
    mockQueryOne.mockResolvedValue(wh)
    await createWarehouse('WH3', 'wh3')
    expect(mockQueryOne).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([null]))
  })

  it('throws when insert returns null', async () => {
    mockQueryOne.mockResolvedValue(null)
    await expect(createWarehouse('X', 'x')).rejects.toThrow('Insert failed')
  })
})

// ---------------------------------------------------------------------------
// updateWarehouse
// ---------------------------------------------------------------------------

describe('updateWarehouse', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws when no fields provided', async () => {
    await expect(updateWarehouse('wh-1', {})).rejects.toThrow('No fields to update')
  })

  it('updates name and returns warehouse', async () => {
    const updated = { id: 'wh-1', name: 'Updated', code: 'OLD', address: null, is_active: true, created_at: '' }
    mockQueryOne.mockResolvedValue(updated)
    const result = await updateWarehouse('wh-1', { name: 'Updated' })
    expect(result.name).toBe('Updated')
  })

  it('uppercases code in update', async () => {
    mockQueryOne.mockResolvedValue({ id: 'wh-1', code: 'NEW' } as any)
    await updateWarehouse('wh-1', { code: 'new' })
    expect(mockQueryOne).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining(['NEW']))
  })

  it('updates address field', async () => {
    mockQueryOne.mockResolvedValue({ id: 'wh-1', address: '456 Rd' } as any)
    const result = await updateWarehouse('wh-1', { address: '456 Rd' })
    expect(result.address).toBe('456 Rd')
  })

  it('updates is_active field', async () => {
    mockQueryOne.mockResolvedValue({ id: 'wh-1', is_active: false } as any)
    const result = await updateWarehouse('wh-1', { is_active: false })
    expect(result.is_active).toBe(false)
  })

  it('updates multiple fields at once', async () => {
    const updated = { id: 'wh-1', name: 'Multi', code: 'MUL', address: 'Addr', is_active: true, created_at: '' }
    mockQueryOne.mockResolvedValue(updated)
    const result = await updateWarehouse('wh-1', { name: 'Multi', code: 'mul', address: 'Addr' })
    expect(result).toEqual(updated)
  })

  it('throws when warehouse not found after update', async () => {
    mockQueryOne.mockResolvedValue(null)
    await expect(updateWarehouse('wh-1', { name: 'x' })).rejects.toThrow('Warehouse not found')
  })
})

// ---------------------------------------------------------------------------
// deleteWarehouse
// ---------------------------------------------------------------------------

describe('deleteWarehouse', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes when no stock', async () => {
    mockQueryOne.mockResolvedValue({ c: '0' })
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    await expect(deleteWarehouse('wh-1')).resolves.toBeUndefined()
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM warehouses'), ['wh-1'])
  })

  it('throws when stock is present', async () => {
    mockQueryOne.mockResolvedValue({ c: '5' })
    await expect(deleteWarehouse('wh-1')).rejects.toThrow('Cannot delete warehouse with stock assigned')
  })

  it('throws when stock count is 1', async () => {
    mockQueryOne.mockResolvedValue({ c: '1' })
    await expect(deleteWarehouse('wh-1')).rejects.toThrow('Cannot delete warehouse with stock assigned')
  })
})

// ---------------------------------------------------------------------------
// listLocations
// ---------------------------------------------------------------------------

describe('listLocations', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns all locations when no warehouseId given', async () => {
    mockQueryMany.mockResolvedValue([])
    await listLocations()
    expect(mockQueryMany).toHaveBeenCalledWith(expect.any(String), [])
  })

  it('filters by warehouseId when provided', async () => {
    mockQueryMany.mockResolvedValue([])
    await listLocations('wh-1')
    expect(mockQueryMany).toHaveBeenCalledWith(expect.any(String), ['wh-1'])
  })

  it('returns locations array', async () => {
    const locs = [{ id: 'loc-1', aisle_code: 'A' }]
    mockQueryMany.mockResolvedValue(locs as any)
    const result = await listLocations('wh-1')
    expect(result).toEqual(locs)
  })
})

// ---------------------------------------------------------------------------
// getLocation
// ---------------------------------------------------------------------------

describe('getLocation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns location when found', async () => {
    mockQueryOne.mockResolvedValue({ id: 'loc-1', aisle_code: 'A' } as any)
    const loc = await getLocation('loc-1')
    expect(loc?.id).toBe('loc-1')
  })

  it('returns null when not found', async () => {
    mockQueryOne.mockResolvedValue(null)
    expect(await getLocation('missing')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// createLocation
// ---------------------------------------------------------------------------

describe('createLocation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws when warehouse not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    await expect(createLocation('wh-1', 'A', '01', '1')).rejects.toThrow('Warehouse not found')
  })

  it('creates location with display code (aisle+shelf uppercased)', async () => {
    const loc = { id: 'loc-new', display_code: 'WH-A-01-1' } as any
    mockQueryOne.mockResolvedValueOnce({ code: 'WH' }).mockResolvedValueOnce(loc)
    const result = await createLocation('wh-1', 'a', '01', '1')
    expect(result.id).toBe('loc-new')
    // display_code should contain uppercase aisle/shelf
    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['A', '1']) // aisle and shelf uppercased
    )
  })

  it('creates location with bin code', async () => {
    const loc = { id: 'loc-bin', display_code: 'WH-A-01-1-B1' } as any
    mockQueryOne.mockResolvedValueOnce({ code: 'WH' }).mockResolvedValueOnce(loc)
    const result = await createLocation('wh-1', 'a', '01', '1', 'B1', 'Near door')
    expect(result.id).toBe('loc-bin')
    expect(mockQueryOne).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining(['B1', 'Near door']))
  })

  it('throws when insert returns null', async () => {
    mockQueryOne.mockResolvedValueOnce({ code: 'WH' }).mockResolvedValueOnce(null)
    await expect(createLocation('wh-1', 'A', '01', '1')).rejects.toThrow('Insert failed')
  })

  it('creates location without optional bin and notes', async () => {
    const loc = { id: 'loc-simple' } as any
    mockQueryOne.mockResolvedValueOnce({ code: 'WH' }).mockResolvedValueOnce(loc)
    const result = await createLocation('wh-1', 'B', '02', '3')
    expect(result.id).toBe('loc-simple')
  })
})

// ---------------------------------------------------------------------------
// updateLocation
// ---------------------------------------------------------------------------

describe('updateLocation', () => {
  beforeEach(() => vi.clearAllMocks())

  const existingLoc = {
    id: 'loc-1',
    warehouse_id: 'wh-1',
    warehouse_code: 'WH',
    aisle_code: 'A',
    rack_code: '01',
    shelf_code: '1',
    bin_code: null,
    display_code: 'WH-A-01-1',
    notes: null,
    is_active: true,
    created_at: '',
  }

  it('throws when location not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    await expect(updateLocation('loc-missing', { notes: 'x' })).rejects.toThrow('Location not found')
  })

  it('updates notes field', async () => {
    const updated = { ...existingLoc, notes: 'new note' }
    mockQueryOne
      .mockResolvedValueOnce(existingLoc) // getLocation
      .mockResolvedValueOnce(updated) // update result
    const result = await updateLocation('loc-1', { notes: 'new note' })
    expect(result.notes).toBe('new note')
  })

  it('updates is_active field', async () => {
    const updated = { ...existingLoc, is_active: false }
    mockQueryOne.mockResolvedValueOnce(existingLoc).mockResolvedValueOnce(updated)
    const result = await updateLocation('loc-1', { is_active: false })
    expect(result.is_active).toBe(false)
  })

  it('updates aisle_code and recomputes display_code', async () => {
    const updated = { ...existingLoc, aisle_code: 'B', display_code: 'WH-B-01-1' }
    mockQueryOne.mockResolvedValueOnce(existingLoc).mockResolvedValueOnce(updated)
    const result = await updateLocation('loc-1', { aisle_code: 'b' })
    expect(result.aisle_code).toBe('B')
  })

  it('updates bin_code to a value', async () => {
    const updated = { ...existingLoc, bin_code: 'B1', display_code: 'WH-A-01-1-B1' }
    mockQueryOne.mockResolvedValueOnce(existingLoc).mockResolvedValueOnce(updated)
    const result = await updateLocation('loc-1', { bin_code: 'B1' })
    expect(result.bin_code).toBe('B1')
  })

  it('updates bin_code to null', async () => {
    const locWithBin = { ...existingLoc, bin_code: 'B1' }
    const updated = { ...existingLoc, bin_code: null }
    mockQueryOne.mockResolvedValueOnce(locWithBin).mockResolvedValueOnce(updated)
    const result = await updateLocation('loc-1', { bin_code: null })
    expect(result.bin_code).toBeNull()
  })

  it('throws when update returns null', async () => {
    mockQueryOne.mockResolvedValueOnce(existingLoc).mockResolvedValueOnce(null)
    await expect(updateLocation('loc-1', { notes: 'x' })).rejects.toThrow('Location not found')
  })
})

// ---------------------------------------------------------------------------
// deleteLocation
// ---------------------------------------------------------------------------

describe('deleteLocation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes when no stock', async () => {
    mockQueryOne.mockResolvedValue({ c: '0' })
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    await expect(deleteLocation('loc-1')).resolves.toBeUndefined()
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM shelf_locations'), ['loc-1'])
  })

  it('throws when stock is present', async () => {
    mockQueryOne.mockResolvedValue({ c: '3' })
    await expect(deleteLocation('loc-1')).rejects.toThrow('Cannot delete location with stock assigned')
  })
})

// ---------------------------------------------------------------------------
// getStockAtLocation
// ---------------------------------------------------------------------------

describe('getStockAtLocation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls queryMany with locationId', async () => {
    mockQueryMany.mockResolvedValue([])
    await getStockAtLocation('loc-1')
    expect(mockQueryMany).toHaveBeenCalledWith(expect.any(String), ['loc-1'])
  })

  it('returns stock array', async () => {
    const stock = [{ id: 's1', product_id: 'p1', quantity: 10 }]
    mockQueryMany.mockResolvedValue(stock as any)
    expect(await getStockAtLocation('loc-1')).toEqual(stock)
  })
})

// ---------------------------------------------------------------------------
// getStockForProduct
// ---------------------------------------------------------------------------

describe('getStockForProduct', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls queryMany with productId and null variant ids', async () => {
    mockQueryMany.mockResolvedValue([])
    await getStockForProduct('prod-1')
    expect(mockQueryMany).toHaveBeenCalledWith(expect.any(String), ['prod-1', null, null])
  })

  it('passes variantId and subVariantId when provided', async () => {
    mockQueryMany.mockResolvedValue([])
    await getStockForProduct('prod-1', 'var-1', 'sv-1')
    expect(mockQueryMany).toHaveBeenCalledWith(expect.any(String), ['prod-1', 'var-1', 'sv-1'])
  })

  it('passes null subVariantId when only variantId provided', async () => {
    mockQueryMany.mockResolvedValue([])
    await getStockForProduct('prod-1', 'var-1')
    expect(mockQueryMany).toHaveBeenCalledWith(expect.any(String), ['prod-1', 'var-1', null])
  })
})

// ---------------------------------------------------------------------------
// adjustStock
// ---------------------------------------------------------------------------

function makeMockClient(responses: any[]) {
  let callIdx = 0
  return {
    query: vi.fn().mockImplementation(() => {
      const resp = responses[callIdx] ?? { rows: [] }
      callIdx++
      return Promise.resolve(resp)
    }),
    release: vi.fn(),
  }
}

describe('adjustStock', () => {
  beforeEach(() => vi.clearAllMocks())

  it('inserts new stock row when no existing stock and quantityChange > 0', async () => {
    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // existing stock query — empty
      { rows: [{ id: 'ss-new' }] }, // INSERT shelf_stock RETURNING *
      { rows: [] }, // INSERT shelf_stock_transactions (transaction log)
      { rows: [{ total: 5 }] }, // syncCentralInventory — SUM query
      { rows: [] }, // UPDATE products (syncCentralInventory)
      { rows: [] }, // COMMIT
    ])
    mockGetClient.mockResolvedValue(client as any)

    // also need queryOne for the final SELECT
    mockQueryOne.mockResolvedValue({ id: 'ss-new', quantity: 5 } as any)

    // Re-mock adjustStock's internal getClient import
    vi.doMock('@/lib/db', () => ({
      query: mockQuery,
      queryOne: mockQueryOne,
      queryMany: mockQueryMany,
      getClient: mockGetClient,
    }))

    await expect(adjustStock('loc-1', 'prod-1', null, null, 5, 'initial', 'admin')).resolves.toBeDefined()
  })

  it('updates existing stock row when found', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'ss-1', quantity: 10 }] }) // existing
        .mockResolvedValueOnce({ rows: [] }) // UPDATE shelf_stock
        .mockResolvedValueOnce({ rows: [] }) // INSERT transaction log
        .mockResolvedValueOnce({ rows: [{ total: 15 }] }) // syncCentralInventory
        .mockResolvedValueOnce({ rows: [] }) // UPDATE products
        .mockResolvedValueOnce({ rows: [] }), // COMMIT
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)
    mockQueryOne.mockResolvedValue({ id: 'ss-1', quantity: 15 } as any)

    const result = await adjustStock('loc-1', 'prod-1', null, null, 5, 'restock')
    expect(result).toBeDefined()
  })

  it('deletes stock row when quantityChange brings it to 0', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'ss-1', quantity: 5 }] }) // existing
        .mockResolvedValueOnce({ rows: [] }) // DELETE shelf_stock
        .mockResolvedValueOnce({ rows: [] }) // INSERT transaction log
        .mockResolvedValueOnce({ rows: [{ total: 0 }] }) // syncCentralInventory
        .mockResolvedValueOnce({ rows: [] }) // UPDATE products
        .mockResolvedValueOnce({ rows: [] }), // COMMIT
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)

    const result = await adjustStock('loc-1', 'prod-1', null, null, -5, 'remove')
    expect(result.quantity).toBe(0)
  })

  it('rolls back and rethrows on error', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockRejectedValueOnce(new Error('DB error')), // existing query fails
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)

    await expect(adjustStock('loc-1', 'prod-1', null, null, 5, 'test')).rejects.toThrow('DB error')
    expect(client.release).toHaveBeenCalled()
  })

  it('uses Math.max(0, quantityChange) when inserting new row with negative change', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // existing — empty
        .mockResolvedValueOnce({ rows: [{ id: 'ss-0' }] }) // insert with qty=0
        .mockResolvedValueOnce({ rows: [] }) // transaction log
        .mockResolvedValueOnce({ rows: [{ total: 0 }] }) // syncCentralInventory
        .mockResolvedValueOnce({ rows: [] }) // UPDATE products
        .mockResolvedValueOnce({ rows: [] }), // COMMIT
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)
    mockQueryOne.mockResolvedValue({ id: 'ss-0', quantity: 0 } as any)

    const result = await adjustStock('loc-1', 'prod-1', null, null, -99, 'negative')
    expect(result.quantity).toBeGreaterThanOrEqual(0)
  })
})

// ---------------------------------------------------------------------------
// moveStock
// ---------------------------------------------------------------------------

describe('moveStock', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws when qty <= 0', async () => {
    await expect(moveStock('from', 'to', 'prod', null, null, 0)).rejects.toThrow('Quantity must be positive')
    await expect(moveStock('from', 'to', 'prod', null, null, -1)).rejects.toThrow('Quantity must be positive')
  })

  it('throws when source and destination are same', async () => {
    await expect(moveStock('loc-1', 'loc-1', 'prod', null, null, 5)).rejects.toThrow(
      'Source and destination must differ'
    )
  })

  it('throws when insufficient stock at source', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'ss-1', quantity: 3 }] }) // from stock — only 3
        .mockResolvedValueOnce({ rows: [] }), // ROLLBACK
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)

    await expect(moveStock('from', 'to', 'prod', null, null, 10)).rejects.toThrow(
      'Insufficient stock at source location'
    )
  })

  it('throws when no stock at source', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ perishable: false }] }) // perishable check
        .mockResolvedValueOnce({ rows: [] }), // from stock — empty
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)

    await expect(moveStock('from', 'to', 'prod', null, null, 5)).rejects.toThrow(
      'Insufficient stock at source location'
    )
  })

  it('moves stock and deletes source row when it hits zero', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ perishable: false }] }) // perishable check
        .mockResolvedValueOnce({ rows: [{ id: 'ss-from', quantity: 5 }] }) // from stock
        .mockResolvedValueOnce({ rows: [] }) // DELETE from
        .mockResolvedValueOnce({ rows: [] }) // INSERT move_out log
        .mockResolvedValueOnce({ rows: [{ id: 'ss-to', quantity: 3 }] }) // to stock — exists
        .mockResolvedValueOnce({ rows: [] }) // UPDATE to
        .mockResolvedValueOnce({ rows: [] }) // INSERT move_in log
        .mockResolvedValueOnce({ rows: [] }), // COMMIT
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)

    await expect(moveStock('from', 'to', 'prod', null, null, 5)).resolves.toBeUndefined()
    expect(client.release).toHaveBeenCalled()
  })

  it('moves stock and updates source row when quantity remains', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ perishable: false }] }) // perishable check
        .mockResolvedValueOnce({ rows: [{ id: 'ss-from', quantity: 10 }] }) // from stock
        .mockResolvedValueOnce({ rows: [] }) // UPDATE from
        .mockResolvedValueOnce({ rows: [] }) // INSERT move_out log
        .mockResolvedValueOnce({ rows: [] }) // to stock — empty
        .mockResolvedValueOnce({ rows: [] }) // INSERT to
        .mockResolvedValueOnce({ rows: [] }) // INSERT move_in log
        .mockResolvedValueOnce({ rows: [] }), // COMMIT
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)

    await expect(moveStock('from', 'to', 'prod', 'var-1', 'sv-1', 4)).resolves.toBeUndefined()
    expect(client.release).toHaveBeenCalled()
  })

  it('rolls back and rethrows on DB error', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockRejectedValueOnce(new Error('move fail')), // from stock query throws
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)

    await expect(moveStock('from', 'to', 'prod', null, null, 3)).rejects.toThrow('move fail')
    expect(client.release).toHaveBeenCalled()
  })

  it('handles perishable product: throws when insufficient batch stock', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ perishable: true }] }) // perishable check
        .mockResolvedValueOnce({ rows: [{ id: 'b1', quantity_remaining: '2' }] }), // batches — only 2 avail
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)

    await expect(moveStock('from', 'to', 'prod', null, null, 10)).rejects.toThrow(
      'Insufficient stock at source location'
    )
    expect(client.release).toHaveBeenCalled()
  })

  it('handles perishable product: moves entire batch when take === avail', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ perishable: true }] }) // perishable check
        .mockResolvedValueOnce({ rows: [{ id: 'b1', quantity_remaining: '5' }] }) // batches (avail=5=take)
        .mockResolvedValueOnce({ rows: [] }) // UPDATE batch location
        .mockResolvedValueOnce({ rows: [] }) // INSERT move_out transaction
        // syncPerishableStock receives the outer client directly (ownClient=false, no BEGIN/COMMIT):
        .mockResolvedValueOnce({ rows: [{ location_id: 'from', total: '0' }] }) // batchTotals SELECT
        .mockResolvedValueOnce({ rows: [{ id: 'ss1', location_id: 'from' }] }) // existing shelf_stock SELECT
        .mockResolvedValueOnce({ rows: [] }) // DELETE shelf_stock (qty=0)
        .mockResolvedValueOnce({ rows: [{ total: '0' }] }) // syncCentralInventory SUM
        .mockResolvedValueOnce({ rows: [] }) // UPDATE products
        .mockResolvedValueOnce({ rows: [] }), // COMMIT
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)

    await expect(moveStock('from', 'to', 'prod', null, null, 5)).resolves.toBeUndefined()
    expect(client.release).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// getBatchesAtLocation
// ---------------------------------------------------------------------------

describe('getBatchesAtLocation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls queryMany with locationId', async () => {
    mockQueryMany.mockResolvedValue([])
    await getBatchesAtLocation('loc-1')
    expect(mockQueryMany).toHaveBeenCalledWith(expect.stringContaining('product_batches'), ['loc-1'])
  })

  it('returns batches array', async () => {
    const batches = [{ id: 'pb1', lot_number: 'LOT-A', quantity_remaining: 10, serials: [] }]
    mockQueryMany.mockResolvedValue(batches as any)
    const result = await getBatchesAtLocation('loc-1')
    expect(result).toEqual(batches)
  })

  it('returns empty array when no batches', async () => {
    mockQueryMany.mockResolvedValue([])
    expect(await getBatchesAtLocation('loc-2')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// getOrCreateOpenShelf
// ---------------------------------------------------------------------------

describe('getOrCreateOpenShelf', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns existing open shelf id when found', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'open-shelf-1' })
    const result = await getOrCreateOpenShelf('wh-1', 'WH')
    expect(result).toBe('open-shelf-1')
    expect(mockQueryOne).toHaveBeenCalledTimes(1)
  })

  it('creates and returns new open shelf when not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'new-open-shelf' })
    const result = await getOrCreateOpenShelf('wh-1', 'WH')
    expect(result).toBe('new-open-shelf')
    expect(mockQueryOne).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// syncPerishableStock
// ---------------------------------------------------------------------------

describe('syncPerishableStock', () => {
  beforeEach(() => vi.clearAllMocks())

  it('opens its own connection when no client provided, commits on success', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // batchTotals — empty
        .mockResolvedValueOnce({ rows: [] }) // existing shelf_stock — empty
        .mockResolvedValueOnce({ rows: [{ total: '0' }] }) // syncCentralInventory SUM
        .mockResolvedValueOnce({ rows: [] }) // UPDATE products
        .mockResolvedValueOnce({ rows: [] }), // COMMIT
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)

    await expect(syncPerishableStock(null, 'prod-1', null, null)).resolves.toBeUndefined()
    expect(client.release).toHaveBeenCalled()
  })

  it('rolls back and rethrows when a query fails', async () => {
    const client = {
      query: vi.fn().mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(new Error('sync fail')),
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)

    await expect(syncPerishableStock(null, 'prod-1', null, null)).rejects.toThrow('sync fail')
    expect(client.release).toHaveBeenCalled()
  })

  it('inserts new shelf_stock row when location not in existing map', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ location_id: 'loc-new', total: '5' }] }) // batchTotals
        .mockResolvedValueOnce({ rows: [] }) // existing shelf_stock — empty
        .mockResolvedValueOnce({ rows: [] }) // INSERT shelf_stock
        .mockResolvedValueOnce({ rows: [{ total: '5' }] }) // syncCentralInventory SUM
        .mockResolvedValueOnce({ rows: [] }) // UPDATE products
        .mockResolvedValueOnce({ rows: [] }), // COMMIT
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)

    await expect(syncPerishableStock(null, 'prod-1', null, null)).resolves.toBeUndefined()
    expect(client.release).toHaveBeenCalled()
  })

  it('deletes shelf_stock row when qty drops to 0 for existing location', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ location_id: 'loc-1', total: '0' }] }) // batchTotals (qty=0)
        .mockResolvedValueOnce({ rows: [{ id: 'ss1', location_id: 'loc-1' }] }) // existing shelf_stock
        .mockResolvedValueOnce({ rows: [] }) // DELETE shelf_stock
        .mockResolvedValueOnce({ rows: [{ total: '0' }] }) // syncCentralInventory SUM
        .mockResolvedValueOnce({ rows: [] }) // UPDATE products
        .mockResolvedValueOnce({ rows: [] }), // COMMIT
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)

    await expect(syncPerishableStock(null, 'prod-1', null, null)).resolves.toBeUndefined()
  })

  it('removes orphaned shelf_stock rows not in batchTotals', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // batchTotals — empty
        .mockResolvedValueOnce({ rows: [{ id: 'orphan-ss', location_id: 'old-loc' }] }) // existing shelf_stock (orphan)
        .mockResolvedValueOnce({ rows: [] }) // DELETE orphan
        .mockResolvedValueOnce({ rows: [{ total: '0' }] }) // syncCentralInventory SUM
        .mockResolvedValueOnce({ rows: [] }) // UPDATE products
        .mockResolvedValueOnce({ rows: [] }), // COMMIT
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)

    await expect(syncPerishableStock(null, 'prod-1', null, null)).resolves.toBeUndefined()
  })

  it('uses provided client and does NOT open its own connection', async () => {
    const externalClient = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] }) // batchTotals — empty
        .mockResolvedValueOnce({ rows: [] }) // existing shelf_stock — empty
        .mockResolvedValueOnce({ rows: [{ total: '0' }] }) // syncCentralInventory SUM
        .mockResolvedValueOnce({ rows: [] }) // UPDATE products
        .mockResolvedValueOnce({ rows: [{ inventory_sync: false }] }), // recompute getInventorySync — sync off, no-op
      release: vi.fn(),
    }

    await expect(syncPerishableStock(externalClient, 'prod-1', null, null)).resolves.toBeUndefined()
    expect(mockGetClient).not.toHaveBeenCalled()
    expect(externalClient.release).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// decrementNonPerishableShelfStock
// ---------------------------------------------------------------------------

describe('decrementNonPerishableShelfStock', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does nothing when qty <= 0', async () => {
    await decrementNonPerishableShelfStock(null, 'prod-1', null, null, 0)
    expect(mockGetClient).not.toHaveBeenCalled()
  })

  it('runs UPDATE via provided txClient', async () => {
    const txClient = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    await decrementNonPerishableShelfStock(txClient, 'prod-1', null, null, 3)
    expect(txClient.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE shelf_stock'),
      expect.arrayContaining([3, 'prod-1'])
    )
  })

  it('opens its own client when txClient is null', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
    mockGetClient.mockResolvedValue(client as any)

    await decrementNonPerishableShelfStock(null, 'prod-2', 'var-1', null, 5)
    expect(mockGetClient).toHaveBeenCalled()
    expect(client.release).toHaveBeenCalled()
  })

  it('releases client even when query throws', async () => {
    const client = {
      query: vi.fn().mockRejectedValue(new Error('decrement fail')),
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)

    await expect(decrementNonPerishableShelfStock(null, 'prod-3', null, null, 2)).rejects.toThrow('decrement fail')
    expect(client.release).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// upsertShelfStock
// ---------------------------------------------------------------------------

describe('upsertShelfStock', () => {
  beforeEach(() => vi.clearAllMocks())

  it('inserts new row when none exists and quantity > 0', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] }) // SELECT — no existing
        .mockResolvedValueOnce({ rows: [] }), // INSERT
    }
    await upsertShelfStock(client, {
      locationId: 'loc-1',
      productId: 'prod-1',
      variantId: null,
      subVariantId: null,
      quantity: 5,
      mode: 'add',
    })
    expect(client.query.mock.calls[1][0]).toContain('INSERT INTO shelf_stock')
  })

  it('does nothing when quantity=0 and no existing row', async () => {
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [] }) }
    await upsertShelfStock(client, {
      locationId: 'loc-1',
      productId: 'prod-1',
      variantId: null,
      subVariantId: null,
      quantity: 0,
      mode: 'set',
    })
    expect(client.query).toHaveBeenCalledTimes(1) // only SELECT
  })

  it('adds to existing quantity in add mode', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: 'ss1', quantity: '10' }] }) // existing=10
        .mockResolvedValueOnce({ rows: [] }), // UPDATE
    }
    await upsertShelfStock(client, {
      locationId: 'loc-1',
      productId: 'prod-1',
      variantId: null,
      subVariantId: null,
      quantity: 3,
      mode: 'add',
    })
    expect(client.query.mock.calls[1][1][0]).toBe(13) // 10 + 3
  })

  it('sets quantity directly in set mode', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: 'ss1', quantity: '10' }] })
        .mockResolvedValueOnce({ rows: [] }),
    }
    await upsertShelfStock(client, {
      locationId: 'loc-1',
      productId: 'prod-1',
      variantId: null,
      subVariantId: null,
      quantity: 7,
      mode: 'set',
    })
    expect(client.query.mock.calls[1][1][0]).toBe(7)
  })

  it('deletes existing row when result quantity is <= 0 in add mode', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: 'ss1', quantity: '5' }] }) // existing=5
        .mockResolvedValueOnce({ rows: [] }), // DELETE
    }
    await upsertShelfStock(client, {
      locationId: 'loc-1',
      productId: 'prod-1',
      variantId: null,
      subVariantId: null,
      quantity: -10,
      mode: 'add',
    })
    expect(client.query.mock.calls[1][0]).toContain('DELETE FROM shelf_stock')
  })

  it('deletes row when set mode results in 0', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: 'ss1', quantity: '5' }] })
        .mockResolvedValueOnce({ rows: [] }),
    }
    await upsertShelfStock(client, {
      locationId: 'loc-1',
      productId: 'prod-1',
      variantId: null,
      subVariantId: null,
      quantity: 0,
      mode: 'set',
    })
    expect(client.query.mock.calls[1][0]).toContain('DELETE FROM shelf_stock')
  })
})
