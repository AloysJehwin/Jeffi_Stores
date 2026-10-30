import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ query: vi.fn() }))

import { query } from '@/lib/shared/db'
import { queueAdsConversion, reconcileOrderConversion, sweepConversions } from '@/lib/google-ads/conversions/queue'
import type { OrderConversionState } from '@/lib/google-ads/conversions/rules'

const NOW = new Date('2026-10-16T06:00:00Z')

const order = (o: Partial<OrderConversionState> = {}): OrderConversionState => ({
  id: 'o1',
  order_number: 'ORD-1',
  status: 'confirmed',
  payment_status: 'paid',
  payment_mode: 'cash',
  total_amount: '1180.00',
  gclid: 'Cj0KCQ',
  gbraid: null,
  wbraid: null,
  attributed_at: '2026-10-15T08:00:00Z',
  created_at: '2026-10-15T09:00:00Z',
  delivered_at: null,
  return_type: null,
  returned_value: null,
  returned_items: null,
  ...o,
})

/** In-memory orders + ads_conversion_uploads with the unique (order_id, kind, version) key. */
function fakeDb(orders: Record<string, OrderConversionState>) {
  const rows: any[] = []
  const db = {
    rows,
    orders,
    query: vi.fn(async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM orders o') && sql.includes('WHERE o.id = $1')) return { rows: db.orders[params[0]] ? [db.orders[params[0]]] : [] }
      if (sql.includes('FROM orders o') && sql.includes('o.created_at > $1')) return { rows: Object.values(db.orders) }
      if (sql.startsWith('SELECT order_id, kind, version')) return { rows: rows.filter(r => params[0].includes(r.order_id)) }
      if (sql.startsWith('INSERT INTO ads_conversion_uploads')) {
        const [order_id, order_number, kind, version, gclid, , , value, click_at, conversion_at, adjustment_at, next_attempt_at] = params
        if (rows.some(r => r.order_id === order_id && r.kind === kind && r.version === version)) return { rows: [], rowCount: 0 }
        rows.push({ order_id, order_number, kind, version, gclid, value, click_at, conversion_at, adjustment_at, next_attempt_at, status: 'pending' })
        return { rows: [{ id: rows.length }], rowCount: 1 }
      }
      throw new Error(`unexpected query ${sql.slice(0, 60)}`)
    }),
  }
  return db
}

beforeEach(() => vi.clearAllMocks())

describe('reconcileOrderConversion', () => {
  it('queues a purchase once an attributed order is paid, and only once', async () => {
    const db = fakeDb({ o1: order() })
    expect(await reconcileOrderConversion(db, 'o1', NOW)).toEqual({ action: 'purchase', value: 1180 })
    expect(db.rows).toMatchObject([{ order_id: 'o1', order_number: 'ORD-1', kind: 'purchase', version: 0, value: 1180, gclid: 'Cj0KCQ' }])
    expect(await reconcileOrderConversion(db, 'o1', NOW)).toEqual({ action: 'none', reason: 'up_to_date' })
    expect(db.rows).toHaveLength(1)
  })

  it('queues a COD order only once delivered', async () => {
    const db = fakeDb({ o1: order({ payment_mode: 'cod', payment_status: 'cod_pending' }) })
    expect(await reconcileOrderConversion(db, 'o1', NOW)).toEqual({ action: 'none', reason: 'up_to_date' })
    db.orders.o1 = { ...db.orders.o1, status: 'delivered', delivered_at: '2026-10-16T05:00:00Z' }
    expect(await reconcileOrderConversion(db, 'o1', NOW)).toMatchObject({ action: 'purchase' })
    expect(new Date(db.rows[0].conversion_at).toISOString()).toBe('2026-10-16T05:00:00.000Z')
  })

  it('retracts on cancellation, once', async () => {
    const db = fakeDb({ o1: order() })
    await reconcileOrderConversion(db, 'o1', NOW)
    db.orders.o1 = { ...db.orders.o1, status: 'cancelled' }
    expect(await reconcileOrderConversion(db, 'o1', NOW)).toEqual({ action: 'retraction', value: 0 })
    expect(await reconcileOrderConversion(db, 'o1', NOW)).toEqual({ action: 'none', reason: 'up_to_date' })
    expect(db.rows.map(r => r.kind)).toEqual(['purchase', 'retraction'])
  })

  it('retracts a full refund and restates a partial return with the new value', async () => {
    const db = fakeDb({ o1: order(), o2: order({ id: 'o2', order_number: 'ORD-2' }) })
    await reconcileOrderConversion(db, 'o1', NOW)
    await reconcileOrderConversion(db, 'o2', NOW)
    db.orders.o1 = { ...db.orders.o1, payment_status: 'refunded' }
    db.orders.o2 = { ...db.orders.o2, status: 'returned', return_type: 'refund', returned_items: 1, returned_value: '180' }
    expect(await reconcileOrderConversion(db, 'o1', NOW)).toEqual({ action: 'retraction', value: 0 })
    expect(await reconcileOrderConversion(db, 'o2', NOW)).toEqual({ action: 'restatement', value: 1000 })
    expect(db.rows.find(r => r.order_id === 'o2' && r.kind === 'restatement')).toMatchObject({ version: 1, value: 1000 })
  })

  it('skips orders without a click and missing orders', async () => {
    const db = fakeDb({ o1: order({ gclid: null }) })
    expect(await reconcileOrderConversion(db, 'o1', NOW)).toEqual({ action: 'none', reason: 'no_click_id' })
    expect(await reconcileOrderConversion(db, 'nope', NOW)).toEqual({ action: 'none', reason: 'not_found' })
    expect(db.query.mock.calls.some(c => String(c[0]).startsWith('INSERT'))).toBe(false)
  })
})

describe('queueAdsConversion', () => {
  it('does not touch the database when the order row shows no click', async () => {
    expect(await queueAdsConversion('o1', { gclid: null, gbraid: null, wbraid: null })).toEqual({ action: 'none', reason: 'no_click_id' })
    expect(await queueAdsConversion('o1', {})).toEqual({ action: 'none', reason: 'no_click_id' })
    expect(await queueAdsConversion(null)).toEqual({ action: 'none', reason: 'no_order' })
    expect(query).not.toHaveBeenCalled()
  })

  it('reconciles through the request DB when there is a click', async () => {
    const db = fakeDb({ o1: order() })
    vi.mocked(query).mockImplementation(db.query as any)
    expect(await queueAdsConversion('o1', { gclid: 'Cj0KCQ' })).toMatchObject({ action: 'purchase' })
    expect(await queueAdsConversion('o1')).toEqual({ action: 'none', reason: 'up_to_date' })
  })

  it('never throws into an order flow', async () => {
    vi.mocked(query).mockRejectedValue(Object.assign(new Error('relation "ads_conversion_uploads" does not exist'), { code: '42P01' }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await queueAdsConversion('o1')).toMatchObject({ action: 'error' })
    warn.mockRestore()
  })
})

describe('sweepConversions', () => {
  it('queues what attributed orders in the click window still need', async () => {
    const db = fakeDb({ o1: order(), o2: order({ id: 'o2', order_number: 'ORD-2' }), o3: order({ id: 'o3', payment_status: 'unpaid' }) })
    await reconcileOrderConversion(db, 'o2', NOW)
    db.query.mockClear()
    expect(await sweepConversions(db, NOW)).toEqual({ checked: 3, enqueued: 1 })
    const [sql, params] = db.query.mock.calls[0] as [string, any[]]
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM ads_conversion_uploads u WHERE u\.order_id = o\.id AND u\.kind = 'retraction'\)/)
    expect((params[0] as Date).toISOString()).toBe('2026-07-13T06:00:00.000Z')
    expect(db.rows.filter(r => r.kind === 'purchase').map(r => r.order_id).sort()).toEqual(['o1', 'o2'])
  })

  it('does nothing when there are no attributed orders', async () => {
    const db = fakeDb({})
    expect(await sweepConversions(db, NOW)).toEqual({ checked: 0, enqueued: 0 })
    expect(db.query).toHaveBeenCalledTimes(1)
  })
})
