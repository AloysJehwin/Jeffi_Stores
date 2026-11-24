import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// The real action handler, order actions, mock adapter and upsert; only the DB, auth and stock
// moves are faked. Every SQL statement is captured so the test can see where tracking lands.
const m = vi.hoisted(() => ({
  requireAdminScope: vi.fn(),
  planGate: vi.fn(),
  resolve: vi.fn(),
  queryMany: vi.fn(),
  sql: [] as { sql: string; params: unknown[] }[],
}))
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: m.requireAdminScope }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: m.planGate }))
vi.mock('@/lib/integrations/resolve', () => ({ IntegrationNotConnectedError: class extends Error {}, resolveMarketplaceCreds: m.resolve }))
vi.mock('@/lib/orders/inventory-deduct', () => ({ deductOrderStock: vi.fn(), InsufficientStockError: class extends Error {} }))
vi.mock('@/lib/orders/order-stock', () => ({ restoreOrderStock: vi.fn() }))
vi.mock('@/lib/marketplace/stock', () => ({ pushStockAfterOrderEvent: vi.fn() }))
vi.mock('@/lib/shared/db', () => {
  const run = async (sql: string, params: unknown[] = []) => {
    m.sql.push({ sql, params })
    if (sql.includes('FROM marketplace_orders WHERE channel'))
      return { rows: [{ id: 'mo1', order_id: 'o1', status: 'accepted', event_at: '2026-11-07T08:00:00Z', stock_state: 'deducted' }] }
    if (sql.startsWith('INSERT INTO marketplace_orders')) return { rows: [{ id: 'mo1' }] }
    return { rows: [] }
  }
  return {
    query: vi.fn(run),
    queryOne: vi.fn(async (sql: string, params: unknown[]) => {
      m.sql.push({ sql, params })
      return { id: 'log1' }
    }),
    queryMany: m.queryMany,
    withTransaction: (fn: (c: unknown) => unknown) => fn({ query: vi.fn(run) }),
  }
})

import { POST } from '@admin/app/api/(admin)/admin/ajio/orders/action/route'

const ID = '0b5f1a3e-6a4c-4b7e-9d1a-2f0c8e7b6a51'
const ADMIN = { adminId: 'a1', email: 'owner@crm.test', role: 'staff', scopes: ['ajio_orders:write'] }
const target = { id: ID, channel: 'ajio', external_order_id: 'AJ-1001', order_id: 'o1', status: 'accepted', currency: 'INR', raw: {}, line_ids: ['L1'] }
const post = (body: unknown) =>
  POST(new NextRequest('https://acme.jeffistores.in/api/admin/ajio/orders/action', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }))

beforeEach(() => {
  vi.clearAllMocks()
  m.sql = []
  m.requireAdminScope.mockResolvedValue(ADMIN)
  m.planGate.mockResolvedValue({ allowed: true, plan: 'pro', upgradeRequired: null })
  m.resolve.mockResolvedValue({ mode: 'mock', fields: {} })
  m.queryMany.mockResolvedValue([target])
})

describe('ajio orders/action route', () => {
  it('needs the orders write scope', async () => {
    await post({ action: 'accept', ids: [ID] })
    expect(m.requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'ajio_orders:write')
    expect(m.planGate).toHaveBeenCalledWith('ajio_orders:write')
  })

  it('refuses a reject without a reason and tells Myntra nothing', async () => {
    const res = await post({ action: 'reject', ids: [ID] })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Give a reason for rejecting.')
    expect(m.resolve).not.toHaveBeenCalled()
    expect(m.sql).toEqual([])
  })

  it('stores RTD tracking in marketplace_shipments, never orders.awb_number', async () => {
    const res = await post({ action: 'ready_to_dispatch', ids: [ID] })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ ok: true, done: 1, failed: 0 })
    const tracking = body.results[0].trackingNumber
    expect(tracking).toMatch(/^MOCK/)
    const shipment = m.sql.find(s => s.sql.includes('INSERT INTO marketplace_shipments'))
    expect(shipment?.params).toEqual(expect.arrayContaining(['mo1', 'o1', 'ajio', tracking, 'ready_to_dispatch']))
    expect(m.sql.filter(s => /awb_number/i.test(s.sql))).toEqual([])
    expect(m.sql.some(s => s.sql.includes('INSERT INTO channel_change_log'))).toBe(true)
  })

  it('reports an order in the wrong state without changing it', async () => {
    m.queryMany.mockResolvedValue([{ ...target, status: 'shipped' }])
    const res = await post({ action: 'accept', ids: [ID] })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain("can't be accepted now")
    expect(m.sql.some(s => s.sql.startsWith('INSERT INTO marketplace_orders'))).toBe(false)
  })

  it('rejects a caller without the scope and a plan without AJIO orders, touching nothing', async () => {
    m.requireAdminScope.mockResolvedValue(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    expect((await post({ action: 'accept', ids: [ID] })).status).toBe(403)
    m.requireAdminScope.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await post({ action: 'accept', ids: [ID] })).status).toBe(401)
    m.requireAdminScope.mockResolvedValue(ADMIN)
    m.planGate.mockResolvedValue({ allowed: false, plan: 'growth', upgradeRequired: 'pro' })
    const res = await post({ action: 'accept', ids: [ID] })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'AJIO orders needs the Pro plan.', upgradeRequired: 'pro' })
    expect(m.resolve).not.toHaveBeenCalled()
    expect(m.sql).toEqual([])
  })

  it('refuses a body with no orders or an unknown action', async () => {
    expect((await post({ action: 'accept', ids: [] })).status).toBe(400)
    expect((await post({ action: 'teleport', ids: [ID] })).status).toBe(400)
    expect(m.sql).toEqual([])
  })

  it('accepts an order, writing the new state and the change log', async () => {
    m.queryMany.mockResolvedValue([{ ...target, status: 'created' }])
    const res = await post({ action: 'accept', ids: [ID] })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, done: 1, failed: 0 })
    expect(m.sql.some(s => s.sql.startsWith('INSERT INTO marketplace_orders'))).toBe(true)
    expect(m.sql.some(s => s.sql.includes('INSERT INTO channel_change_log'))).toBe(true)
  })

  it('answers a marketplace failure with a readable error', async () => {
    m.resolve.mockRejectedValue(Object.assign(new Error('AJIO is down'), { httpStatus: 503 }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await post({ action: 'ready_to_dispatch', ids: [ID] })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(600)
    expect(m.sql.some(s => s.sql.includes('INSERT INTO marketplace_shipments'))).toBe(false)
  })
})
