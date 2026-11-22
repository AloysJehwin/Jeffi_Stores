import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@jeffi/tenancy', () => ({
  withTransaction: vi.fn(),
  getClient: vi.fn(),
}))

vi.mock('../../src/lib/inventory.js', () => ({
  logStockMovement: vi.fn().mockResolvedValue(undefined),
  recomputeStockStatusForProduct: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/lib/shelf.js', () => ({
  syncPerishableStock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/lib/product-label.js', () => ({
  productLabel: vi.fn((x: any) => x?.product_name ?? 'item'),
}))

vi.mock('../../src/lib/invoice-line-items.js', () => ({
  buildShortfall: vi.fn(),
}))

import {
  deleteBatchIfEmpty,
  deductStockForLines,
  InsufficientStockError,
  type LineItem,
} from '../../src/lib/inventory-deduct.js'
import { logStockMovement } from '../../src/lib/inventory.js'

const mockLog = vi.mocked(logStockMovement)

beforeEach(() => {
  vi.clearAllMocks()
})

// A fake tx client that answers queries by SQL substring; the serialized-sale
// path (lines 452-544) drives most of its behaviour off these matches.
function makeSerialClient(opts: {
  serialized?: boolean
  perishable?: boolean
  autoSerials?: { id: string; serial_number: string; batch_id: string | null }[]
  manualLookup?: Record<string, { id: string; batch_id: string | null } | null>
  unitRow?: any
} = {}) {
  const calls: { sql: string; params?: any[] }[] = []
  const query = vi.fn(async (sql: string, params?: any[]) => {
    calls.push({ sql, params })
    if (/FROM product_units/i.test(sql)) {
      return { rows: opts.unitRow ? [opts.unitRow] : [] }
    }
    if (/SELECT perishable, serialized FROM products/i.test(sql)) {
      return { rows: [{ perishable: !!opts.perishable, serialized: !!opts.serialized }] }
    }
    // manual serial lookup
    if (/SELECT id, batch_id FROM product_serials/i.test(sql)) {
      const sn = params?.[1] as string
      const row = opts.manualLookup?.[sn]
      return { rows: row ? [row] : [] }
    }
    // auto FEFO serial pick
    if (/FROM product_serials ps/i.test(sql)) {
      return { rows: opts.autoSerials ?? [] }
    }
    if (/UPDATE product_serials SET status = 'sold'/i.test(sql)) return { rows: [] }
    if (/UPDATE product_batches SET quantity_remaining = GREATEST/i.test(sql)) {
      return { rows: [{ lot_number: 'LOT1', expiry_date: '2030-01-01' }] }
    }
    if (/UPDATE order_items SET batch_id/i.test(sql)) return { rows: [] }
    if (/DELETE FROM product_batches/i.test(sql)) return { rowCount: 1, rows: [] }
    return { rows: [], rowCount: 0 }
  })
  return { query, calls }
}

const line = (over: Partial<LineItem> = {}): LineItem => ({
  id: 'li-1',
  product_id: 'p1',
  variant_id: null,
  sub_variant_id: null,
  product_name: 'Widget',
  quantity: 2,
  base_quantity: 2,
  ...over,
})

// ── deleteBatchIfEmpty ────────────────────────────────────────────────────
describe('deleteBatchIfEmpty', () => {
  it('returns false and skips the query when batchId is falsy', async () => {
    const client = { query: vi.fn() }
    expect(await deleteBatchIfEmpty(client, null)).toBe(false)
    expect(await deleteBatchIfEmpty(client, undefined)).toBe(false)
    expect(client.query).not.toHaveBeenCalled()
  })
  it('returns true when a row was deleted', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rowCount: 1 }) }
    expect(await deleteBatchIfEmpty(client, 'b1')).toBe(true)
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM product_batches'), ['b1'])
  })
  it('returns false when no row matched (quantity_remaining > 0)', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rowCount: 0 }) }
    expect(await deleteBatchIfEmpty(client, 'b1')).toBe(false)
  })
})

// ── InsufficientStockError ────────────────────────────────────────────────
describe('InsufficientStockError', () => {
  it('carries detail message, customerMessage and OUT_OF_STOCK code', () => {
    const e = new InsufficientStockError('detail for admin', 'safe for customer')
    expect(e.message).toBe('detail for admin')
    expect(e.customerMessage).toBe('safe for customer')
    expect(e.code).toBe('OUT_OF_STOCK')
    expect(e.name).toBe('InsufficientStockError')
    expect(e).toBeInstanceOf(Error)
  })
})

// ── deductStockForLines → deductSerialized (lines 452-544) ────────────────
describe('deductStockForLines — serialized auto-FEFO', () => {
  it('marks N serials sold, decrements each batch by perSerialBase, logs movements', async () => {
    const client = makeSerialClient({
      serialized: true,
      // baseQty 2, step 1 → needed 2 serials
      autoSerials: [
        { id: 's1', serial_number: 'SN1', batch_id: 'b1' },
        { id: 's2', serial_number: 'SN2', batch_id: 'b1' },
      ],
    })
    await deductStockForLines(client as any, 'order-1', [line({ quantity: 2, base_quantity: 2 })])

    // two UPDATE product_serials ... 'sold'
    const soldCalls = client.calls.filter(c => /SET status = 'sold'/i.test(c.sql))
    expect(soldCalls).toHaveLength(2)
    // batch decrement uses perSerialBase = baseQty/serials = 2/2 = 1
    const batchDec = client.calls.filter(c => /GREATEST\(0, quantity_remaining - \$2/i.test(c.sql))
    expect(batchDec).toHaveLength(2)
    expect(batchDec[0].params?.[1]).toBe(1)
    // one ledger movement per serial
    expect(mockLog).toHaveBeenCalledTimes(2)
    expect(mockLog.mock.calls[0][1]).toMatchObject({ quantityChange: -1, serialNumber: 'SN1' })
  })

  it('throws InsufficientStockError when fewer serials than needed (auto)', async () => {
    const client = makeSerialClient({
      serialized: true,
      autoSerials: [{ id: 's1', serial_number: 'SN1', batch_id: null }], // only 1, need 2
    })
    await expect(
      deductStockForLines(client as any, 'order-1', [line({ quantity: 2, base_quantity: 2 })])
    ).rejects.toThrow(/Not enough serial units/)
  })
})

describe('deductStockForLines — serialized manual assignments', () => {
  it('resolves each manual serial and marks it sold', async () => {
    const client = makeSerialClient({
      serialized: true,
      manualLookup: { SNX: { id: 'sx', batch_id: 'b9' } },
    })
    await deductStockForLines(
      client as any,
      'order-9',
      [line({ id: 'li-9', quantity: 1, base_quantity: 1 })],
      { serialAssignments: [{ order_item_id: 'li-9', serial_number: 'SNX' }] }
    )
    expect(client.calls.some(c => /SET status = 'sold'/i.test(c.sql))).toBe(true)
    expect(mockLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ serialNumber: 'SNX' }))
  })

  it('throws when a manual serial is not in stock', async () => {
    const client = makeSerialClient({ serialized: true, manualLookup: { MISS: null } })
    await expect(
      deductStockForLines(client as any, 'order-9', [line({ id: 'li-9', quantity: 1, base_quantity: 1 })], {
        serialAssignments: [{ order_item_id: 'li-9', serial_number: 'MISS' }],
      })
    ).rejects.toThrow(/is not available/)
  })

  it('requireSerialAssignments: throws when count mismatches needed', async () => {
    const client = makeSerialClient({ serialized: true })
    await expect(
      deductStockForLines(
        client as any,
        'order-9',
        [line({ id: 'li-9', quantity: 2, base_quantity: 2 })], // needs 2
        { requireSerialAssignments: true, serialAssignments: [{ order_item_id: 'li-9', serial_number: 'ONE' }] }
      )
    ).rejects.toThrow(/expected 2 serial number\(s\)/)
  })
})
