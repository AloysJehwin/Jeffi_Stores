import { describe, it, expect, vi, beforeEach } from 'vitest'

// An in-memory marketplace_orders / orders / order_items store, driven through the real upsert.
const state = vi.hoisted(() => ({
  orders: new Map<string, { id: string; order_id: string; status: string; event_at: string | null; stock_state: string; stock_note: string | null }>(),
  ourOrders: [] as { id: string; number: string; status: string }[],
  orderItems: [] as { order_id: string; sku: string; sub_variant_id: string | null }[],
  units: [] as any[],
  sql: [] as string[],
  clients: [] as any[],
}))
const m = vi.hoisted(() => ({ deduct: vi.fn(), restore: vi.fn() }))

vi.mock('@/lib/shared/db', () => {
  const client = {
    query: vi.fn(async (sql: string, p: any[] = []) => {
      state.sql.push(sql)
      if (sql.includes('FROM marketplace_orders WHERE channel')) {
        const r = state.orders.get(`${p[0]}:${p[1]}`)
        return { rows: r ? [r] : [] }
      }
      if (sql.includes('FROM marketplace_listings l JOIN products')) {
        return {
          rows: (p[1] as string[])
            .filter(s => s === 'TEE-RED-M')
            .map(sku => ({ sku, product_id: 'p1', variant_id: 'v-red', sub_variant_id: 'sv-red-m', name: 'Crew Tee', variant_name: 'Red', sub_variant_name: 'M', hsn_code: '6109', gst_rate: '5', matched_by: 'sub_variant', active: true })),
        }
      }
      if (sql.startsWith('INSERT INTO orders')) {
        const id = `o${state.ourOrders.length + 1}`
        state.ourOrders.push({ id, number: p[0], status: p[2] })
        return { rows: [{ id }] }
      }
      if (sql.startsWith('UPDATE orders SET status')) {
        state.ourOrders.find(o => o.id === p[0])!.status = p[1]
        return { rows: [] }
      }
      if (sql.startsWith('INSERT INTO order_items')) {
        state.orderItems.push({ order_id: p[0], sku: p[5], sub_variant_id: p[3] })
        return { rows: [] }
      }
      if (sql.startsWith('SELECT 1 FROM order_items')) return { rows: state.orderItems.filter(i => i.order_id === p[0]).map(() => ({ '?column?': 1 })) }
      if (sql.startsWith('INSERT INTO marketplace_orders')) {
        const key = `${p[0]}:${p[1]}`
        const prev = state.orders.get(key)
        const id = prev?.id ?? `mo${state.orders.size + 1}`
        state.orders.set(key, { id, order_id: p[2], status: p[3], event_at: p[6] ?? prev?.event_at ?? null, stock_state: prev?.stock_state ?? 'none', stock_note: prev?.stock_note ?? null })
        return { rows: [{ id }] }
      }
      if (sql.startsWith('INSERT INTO marketplace_order_items')) {
        for (const u of JSON.parse(p[2])) if (!state.units.some(x => x.line_id === u.line_id && x.unit_index === u.unit_index)) state.units.push(u)
        return { rows: [] }
      }
      if (sql.startsWith('SELECT 1 FROM marketplace_order_items')) return { rows: state.units.filter(u => !u.product_id).slice(0, 1) }
      if (sql.startsWith('UPDATE marketplace_orders SET stock_state')) {
        const r = [...state.orders.values()].find(o => o.id === p[0])!
        r.stock_state = p[1]
        r.stock_note = p[2] ?? r.stock_note
      }
      return { rows: [] }
    }),
  }
  return {
    withTransaction: async (fn: any) => {
      state.clients.push(client)
      return fn(client)
    },
    query: vi.fn(),
    queryOne: vi.fn(),
    queryMany: vi.fn(),
  }
})
vi.mock('@/lib/orders/inventory-deduct', () => ({
  deductOrderStock: m.deduct,
  InsufficientStockError: class InsufficientStockError extends Error {},
}))
vi.mock('@/lib/orders/order-stock', () => ({ restoreOrderStock: m.restore }))

import { upsertMarketplaceOrder, orderNumberFor } from '@/lib/marketplace/upsert'
import { InsufficientStockError } from '@/lib/orders/inventory-deduct'
import type { NormalizedOrder } from '@/lib/marketplace/types'

const order = (status: NormalizedOrder['status'], over: Partial<NormalizedOrder> = {}): NormalizedOrder => ({
  channel: 'myntra',
  externalOrderId: '1190021',
  status,
  eventAt: null,
  lines: [{ lineId: 'L1', sku: 'TEE-RED-M', quantity: 2, unitPrice: 499, unitTax: 24 }],
  shipment: { packetId: 'PKT1', trackingNumber: 'TRK123', courier: 'Ekart' },
  ...over,
})

beforeEach(() => {
  state.orders.clear()
  state.ourOrders.length = 0
  state.orderItems.length = 0
  state.units.length = 0
  state.sql.length = 0
  state.clients.length = 0
  vi.clearAllMocks()
})

describe('upsertMarketplaceOrder', () => {
  it('creates one order, deducts once on accept inside the transaction, restores once on cancel', async () => {
    const a = await upsertMarketplaceOrder(order('created'))
    expect(a).toMatchObject({ created: true, applied: true, orderNumber: 'MYN-1190021', stock: 'none', stockState: 'none' })
    expect(state.orderItems).toEqual([{ order_id: a.orderId, sku: 'TEE-RED-M', sub_variant_id: 'sv-red-m' }])
    expect(state.units.map(u => u.unit_index)).toEqual([1, 2])

    const b = await upsertMarketplaceOrder(order('accepted'))
    expect(b).toMatchObject({ created: false, orderId: a.orderId, stock: 'deduct', stockState: 'deducted' })
    expect(m.deduct).toHaveBeenCalledTimes(1)
    expect(m.deduct).toHaveBeenCalledWith(a.orderId, {}, state.clients[1])
    expect(state.sql).toContain('SAVEPOINT marketplace_stock')

    await upsertMarketplaceOrder(order('accepted'))
    await upsertMarketplaceOrder(order('packed'))
    expect(m.deduct).toHaveBeenCalledTimes(1)

    const c = await upsertMarketplaceOrder(order('cancelled'))
    expect(c).toMatchObject({ stock: 'restore', stockState: 'restored' })
    expect(m.restore).toHaveBeenCalledWith(a.orderId, state.clients[state.clients.length - 1])
    await upsertMarketplaceOrder(order('cancelled'))
    expect(m.restore).toHaveBeenCalledTimes(1)
    expect(state.ourOrders).toHaveLength(1)
    expect(state.ourOrders[0].status).toBe('cancelled')
  })

  it('a replayed event leaves one order', async () => {
    await upsertMarketplaceOrder(order('accepted'))
    await upsertMarketplaceOrder(order('accepted'))
    await upsertMarketplaceOrder(order('accepted'))
    expect(state.ourOrders).toHaveLength(1)
    expect(state.orderItems).toHaveLength(1)
    expect(state.units).toHaveLength(2)
    expect(m.deduct).toHaveBeenCalledTimes(1)
  })

  it('ignores a stale event', async () => {
    await upsertMarketplaceOrder(order('packed'))
    const r = await upsertMarketplaceOrder(order('created'))
    expect(r).toMatchObject({ applied: false, status: 'packed', stock: 'none' })
    expect(state.ourOrders[0].status).toBe('processing')
  })

  it('records a stock shortfall and rolls the partial deduction back', async () => {
    m.deduct.mockRejectedValueOnce(new InsufficientStockError('Crew Tee Red M: need 2, have 1', 'Out of stock'))
    const r = await upsertMarketplaceOrder(order('accepted'))
    expect(r.stockState).toBe('short')
    expect(state.sql).toContain('ROLLBACK TO SAVEPOINT marketplace_stock')
    expect([...state.orders.values()][0].stock_note).toContain('need 2')
  })

  it('marks an order with no matching SKU as unmatched without deducting', async () => {
    const r = await upsertMarketplaceOrder(order('accepted', { lines: [{ lineId: 'L1', sku: 'UNKNOWN', quantity: 1, unitPrice: 100 }] }))
    expect(r.stockState).toBe('unmatched')
    expect(m.deduct).not.toHaveBeenCalled()
  })

  it('never writes orders.awb_number', async () => {
    await upsertMarketplaceOrder(order('accepted'))
    await upsertMarketplaceOrder(order('shipped'))
    expect(state.sql.length).toBeGreaterThan(5)
    expect(state.sql.some(s => /awb_number/i.test(s))).toBe(false)
    expect(state.sql.some(s => s.startsWith('INSERT INTO marketplace_shipments') || s.startsWith('UPDATE marketplace_shipments'))).toBe(true)
  })

  it('keeps order numbers within 50 characters', () => {
    expect(orderNumberFor('ajio', 'FN123')).toBe('AJI-FN123')
    const long = orderNumberFor('ajio', 'X'.repeat(80))
    expect(long.length).toBe(50)
    expect(long.startsWith('AJI-')).toBe(true)
  })
})
