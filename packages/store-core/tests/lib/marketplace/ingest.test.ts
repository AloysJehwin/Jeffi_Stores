import { describe, it, expect, vi, beforeEach } from 'vitest'

const db = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ ...db, withTransaction: vi.fn() }))
vi.mock('@/lib/marketplace/upsert', () => ({ upsertMarketplaceOrder: vi.fn(), orderNumberFor: (c: string, id: string) => `${c}-${id}` }))
vi.mock('@/lib/integrations/resolve', () => ({ resolveMarketplaceCreds: vi.fn() }))

import { recordEvents, processEvent, retryPendingEvents, backoffMs, MAX_ATTEMPTS } from '@/lib/marketplace/ingest'
import { upsertMarketplaceOrder } from '@/lib/marketplace/upsert'
import { resolveMarketplaceCreds } from '@/lib/integrations/resolve'

const upsert = vi.mocked(upsertMarketplaceOrder)
const payload = { orderId: 'MO-1', status: 'ACCEPTED', lines: [{ lineId: 'L1', sku: 'TEE-RED-M', price: 499 }] }
const claimed = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  channel: 'myntra',
  event_key: 'k1',
  event_type: 'order.accepted',
  external_order_id: 'MO-1',
  occurred_at: null,
  payload,
  source: 'mock',
  attempts: 1,
  ...over,
})
const lastUpdate = () => db.query.mock.calls[db.query.mock.calls.length - 1] as [string, any[]]

beforeEach(() => {
  vi.clearAllMocks()
  db.query.mockResolvedValue({ rows: [] })
})

describe('recordEvents', () => {
  it('stores each key once and reports replays as duplicates', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'e1' }] })
    const ev = { key: 'k1', type: 'order.accepted', externalOrderId: 'MO-1', occurredAt: 'not a date', payload }
    const r = await recordEvents('myntra', [ev, ev, { ...ev, key: 'k2' }])
    expect(r).toEqual({ ids: ['e1'], duplicates: 2 })
    const [sql, params] = db.query.mock.calls[0] as [string, any[]]
    expect(sql).toContain('ON CONFLICT (channel, event_key) DO NOTHING')
    const rows = JSON.parse(params[1])
    expect(rows.map((x: any) => x.key)).toEqual(['k1', 'k2'])
    expect(rows[0].occurred_at).toBeNull()
    expect(params[2]).toBe('push')
  })

  it('throws when the write fails, so the push can answer 503', async () => {
    db.query.mockRejectedValueOnce(new Error('connection refused'))
    await expect(recordEvents('ajio', [{ key: 'k', type: 't', externalOrderId: null, occurredAt: null, payload: {} }])).rejects.toThrow('connection refused')
  })
})

describe('processEvent', () => {
  it('normalises a claimed event and upserts the order', async () => {
    db.queryOne.mockResolvedValueOnce(claimed())
    upsert.mockResolvedValueOnce({ marketplaceOrderId: 'mo1', orderNumber: 'MYN-MO-1' } as any)
    const r = await processEvent('e1')
    expect(r).toEqual({ outcome: 'done', orderNumber: 'MYN-MO-1' })
    expect(upsert.mock.calls[0][0]).toMatchObject({ channel: 'myntra', externalOrderId: 'MO-1', status: 'accepted' })
    expect(lastUpdate()[0]).toContain("status = 'done'")
  })

  it('skips an event that is not due or already handled', async () => {
    db.queryOne.mockResolvedValueOnce(null)
    expect(await processEvent('e1')).toEqual({ outcome: 'skipped' })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('backs off on failure and fails after the last attempt', async () => {
    db.queryOne.mockResolvedValueOnce(claimed({ attempts: 2 }))
    upsert.mockRejectedValueOnce(new Error('deadlock detected'))
    expect(await processEvent('e1')).toEqual({ outcome: 'retry', error: 'deadlock detected' })
    expect(lastUpdate()[1]).toEqual(['e1', 'pending', 'deadlock detected', backoffMs(2)])

    db.queryOne.mockResolvedValueOnce(claimed({ attempts: MAX_ATTEMPTS }))
    upsert.mockRejectedValueOnce(new Error('still broken'))
    expect((await processEvent('e1')).outcome).toBe('failed')
    expect(lastUpdate()[1][1]).toBe('failed')
  })

  it('parks pushed events the live adapter cannot map yet', async () => {
    db.queryOne.mockResolvedValueOnce(claimed({ source: 'push', attempts: MAX_ATTEMPTS, payload: { ...payload, status: 'SOMETHING_NEW' } }))
    vi.mocked(resolveMarketplaceCreds).mockResolvedValueOnce({ mode: 'live', fields: {} })
    const r = await processEvent('e1')
    expect(r.outcome).toBe('retry')
    expect(upsert).not.toHaveBeenCalled()
    expect(lastUpdate()[1]).toEqual(['e1', 'pending', expect.stringContaining('field mapping'), 6 * 3600_000])
  })

  it('splits a parked raw body through the live adapter and runs its events', async () => {
    const body = { orders: [{ orderReleaseId: 'MO-7', orderStatus: 'ACCEPTED', orderLines: [{ orderLineId: 'L1', sellerSkuCode: 'TEE-RED-M', sellingPrice: 499 }] }] }
    db.queryOne.mockResolvedValueOnce(claimed({ source: 'push', event_type: 'raw', payload: body })).mockResolvedValueOnce(claimed({ id: 'e2', source: 'push', event_type: 'order.accepted', payload: body.orders[0] }))
    vi.mocked(resolveMarketplaceCreds).mockResolvedValue({ mode: 'live', fields: {} })
    db.query.mockResolvedValueOnce({ rows: [{ id: 'e2' }] })
    upsert.mockResolvedValueOnce({ marketplaceOrderId: 'mo7', orderNumber: 'MYN-MO-7' } as any)
    expect(await processEvent('e1')).toEqual({ outcome: 'done' })
    expect(JSON.parse((db.query.mock.calls[0] as any[])[1][1])[0]).toMatchObject({ order_id: 'MO-7' })
    expect(upsert.mock.calls[0][0]).toMatchObject({ channel: 'myntra', externalOrderId: 'MO-7', status: 'accepted' })
  })

  it('ignores events that are not about an order', async () => {
    db.queryOne.mockResolvedValueOnce(claimed({ payload: { orderId: 'MO-1', status: 'PING' } }))
    expect(await processEvent('e1')).toEqual({ outcome: 'ignored' })
    expect(lastUpdate()[0]).toContain("status = 'ignored'")
  })
})

describe('retryPendingEvents', () => {
  it('works through due events oldest first and tallies them', async () => {
    db.queryMany.mockResolvedValueOnce([{ id: 'e1' }, { id: 'e2' }])
    db.queryOne.mockResolvedValueOnce(claimed()).mockResolvedValueOnce(null)
    upsert.mockResolvedValueOnce({ marketplaceOrderId: 'mo1', orderNumber: 'MYN-MO-1' } as any)
    const r = await retryPendingEvents('myntra', { limit: 10 })
    expect(r).toEqual({ processed: 2, done: 1, failed: 0, retry: 0, remaining: 0 })
    expect((db.queryMany.mock.calls[0] as any[])[1]).toEqual(['myntra', 10])
  })

  it('backs off exponentially up to six hours', () => {
    expect([1, 2, 3].map(backoffMs)).toEqual([30_000, 60_000, 120_000])
    expect(backoffMs(30)).toBe(6 * 3600_000)
  })
})
