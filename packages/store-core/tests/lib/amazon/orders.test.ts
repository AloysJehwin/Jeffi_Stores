import { describe, it, expect, vi, beforeEach } from 'vitest'

// An in-memory amazon_orders row per Amazon id, driven through the real upsertAmazonOrder.
const state = vi.hoisted(() => ({ orders: new Map<string, { order_id: string; stock_state: string }>(), nextId: 1 }))
const m = vi.hoisted(() => ({ deduct: vi.fn(), restore: vi.fn() }))

vi.mock('@/lib/shared/db', () => {
  const client = {
    query: vi.fn(async (sql: string, p: any[] = []) => {
      if (sql.includes('FROM amazon_orders WHERE amazon_order_id')) {
        const r = state.orders.get(p[0])
        return { rows: r ? [r] : [] }
      }
      if (sql.includes('FROM product_variants v JOIN products')) return { rows: [{ sku: 'SKU1', product_id: 'p1', variant_id: null, name: 'Drill', variant_name: null, hsn_code: null, gst_rate: '18' }] }
      if (sql.startsWith('INSERT INTO orders')) return { rows: [{ id: `o${state.nextId++}` }] }
      if (sql.startsWith('INSERT INTO amazon_orders')) {
        const prev = state.orders.get(p[0])
        state.orders.set(p[0], { order_id: p[1], stock_state: prev?.stock_state ?? 'none' })
      }
      return { rows: [], rowCount: 1 }
    }),
  }
  return {
    withTransaction: async (fn: any) => fn(client),
    query: vi.fn(),
    queryMany: vi.fn(),
    queryOne: vi.fn(async (sql: string, p: any[]) => {
      if (sql.startsWith('UPDATE amazon_orders SET stock_state')) state.orders.get(p[0])!.stock_state = p[1]
      return null
    }),
    getClient: vi.fn(),
  }
})
vi.mock('@/lib/orders/inventory-deduct', () => ({
  deductOrderStock: m.deduct,
  InsufficientStockError: class InsufficientStockError extends Error {},
}))
vi.mock('@/lib/orders/order-stock', () => ({ restoreOrderStock: m.restore }))

import { upsertAmazonOrder, ourStatus, stockAction } from '@/lib/amazon/orders'
import { InsufficientStockError } from '@/lib/orders/inventory-deduct'
import { desiredQuantity } from '@/lib/amazon/stock'

const order = (status: string, channel = 'MFN') => ({ AmazonOrderId: '405-1', OrderStatus: status, FulfillmentChannel: channel, OrderTotal: { Amount: '1180', CurrencyCode: 'INR' }, PurchaseDate: '2026-10-16T08:00:00Z' })
const items = [{ OrderItemId: 'i1', SellerSKU: 'SKU1', QuantityOrdered: 2, ItemPrice: { Amount: '1180' }, ItemTax: { Amount: '180' } }]

beforeEach(() => {
  state.orders.clear()
  vi.clearAllMocks()
})

describe('status and stock rules', () => {
  it('maps Amazon statuses', () => {
    expect(['Pending', 'Unshipped', 'PartiallyShipped', 'Shipped', 'Canceled', 'Unfulfillable'].map(ourStatus)).toEqual(['pending', 'confirmed', 'processing', 'shipped', 'cancelled', null])
  })
  it('only merchant-fulfilled orders move stock, once each way', () => {
    expect(stockAction('AFN', 'Shipped', 'none')).toBe('none')
    expect(stockAction('MFN', 'Pending', 'none')).toBe('none')
    expect(stockAction('MFN', 'Unshipped', 'none')).toBe('deduct')
    expect(stockAction('MFN', 'Shipped', 'deducted')).toBe('none')
    expect(stockAction('MFN', 'Canceled', 'deducted')).toBe('restore')
    expect(stockAction('MFN', 'Canceled', 'none')).toBe('none')
    expect(stockAction('MFN', 'Canceled', 'restored')).toBe('none')
  })
  it('pushes available minus held units and buffer, never negative', () => {
    expect(desiredQuantity(10.7, 2, 1)).toBe(7)
    expect(desiredQuantity(1, 3, 0)).toBe(0)
    expect(desiredQuantity(null, 0, 0)).toBe(0)
  })
})

describe('upsertAmazonOrder', () => {
  it('creates once, deducts once on confirm, ignores replays, restores once on cancel', async () => {
    const a = await upsertAmazonOrder(order('Pending'), items)
    expect(a).toMatchObject({ created: true, stock: 'none' })
    const b = await upsertAmazonOrder(order('Unshipped'), items)
    expect(b).toMatchObject({ created: false, orderId: a.orderId, stock: 'deduct', stockState: 'deducted' })
    await upsertAmazonOrder(order('Unshipped'), items)
    await upsertAmazonOrder(order('Shipped'), items)
    expect(m.deduct).toHaveBeenCalledTimes(1)
    const c = await upsertAmazonOrder(order('Canceled'), items)
    expect(c).toMatchObject({ stock: 'restore', stockState: 'restored' })
    await upsertAmazonOrder(order('Canceled'), items)
    expect(m.restore).toHaveBeenCalledTimes(1)
    expect(m.restore).toHaveBeenCalledWith(a.orderId)
  })
  it('never moves stock for FBA orders', async () => {
    await upsertAmazonOrder(order('Shipped', 'AFN'), items)
    await upsertAmazonOrder(order('Canceled', 'AFN'), items)
    expect(m.deduct).not.toHaveBeenCalled()
    expect(m.restore).not.toHaveBeenCalled()
  })
  it('records a shortage and retries the deduction on the next update', async () => {
    m.deduct.mockRejectedValueOnce(new (InsufficientStockError as any)('Only 1 left'))
    const a = await upsertAmazonOrder(order('Unshipped'), items)
    expect(a.stockState).toBe('short')
    const b = await upsertAmazonOrder(order('Shipped'), items)
    expect(b.stockState).toBe('deducted')
    expect(m.deduct).toHaveBeenCalledTimes(2)
  })
})
