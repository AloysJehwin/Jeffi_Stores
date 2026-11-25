import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => {
  class NotConnected extends Error {}
  return { NotConnected, requireAdminScope: vi.fn(), planGate: vi.fn(), orders: vi.fn(), stock: vi.fn() }
})
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: m.requireAdminScope }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: m.planGate }))
vi.mock('@/lib/integrations/resolve', () => ({ IntegrationNotConnectedError: m.NotConnected }))
vi.mock('@/lib/amazon/orders', () => ({ loadAmazonOrders: m.orders }))
vi.mock('@/lib/amazon/stock', () => ({ loadStock: m.stock }))

import { GET } from '@admin/app/api/(admin)/admin/amazon/orders/route'

const ADMIN = { adminId: 'a1', email: 'owner@crm.test', role: 'staff', scopes: ['amazon:read'] }
const get = () => GET(new NextRequest('https://acme.jeffistores.in/api/admin/amazon/orders'))

beforeEach(() => {
  vi.clearAllMocks()
  m.requireAdminScope.mockResolvedValue(ADMIN)
  m.planGate.mockResolvedValue({ allowed: true, plan: 'pro', upgradeRequired: null })
  m.orders.mockResolvedValue([{ id: 'o1' }])
  m.stock.mockResolvedValue({ enabled: true, rows: [] })
})

describe('amazon orders route', () => {
  it('needs amazon:read and the plan', async () => {
    m.requireAdminScope.mockResolvedValue(NextResponse.json({ error: 'nope' }, { status: 403 }))
    expect((await get()).status).toBe(403)
    expect(m.requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'amazon:read')
    m.requireAdminScope.mockResolvedValue(ADMIN)
    m.planGate.mockResolvedValue({ allowed: false, plan: 'growth', upgradeRequired: 'pro' })
    expect((await get()).status).toBe(403)
    expect(m.orders).not.toHaveBeenCalled()
    expect(m.stock).not.toHaveBeenCalled()
  })

  it('returns the imported orders and the stock state together', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ orders: [{ id: 'o1' }], stock: { enabled: true, rows: [] } })
  })

  it('maps failures: not connected 409, upstream 502', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    m.orders.mockRejectedValueOnce(new m.NotConnected('x'))
    const nc = await get()
    expect(nc.status).toBe(409)
    expect((await nc.json()).error).toBe('Connect Amazon first.')
    m.stock.mockRejectedValueOnce(Object.assign(new Error('Amazon down'), { httpStatus: 503 }))
    expect((await get()).status).toBe(502)
  })
})
