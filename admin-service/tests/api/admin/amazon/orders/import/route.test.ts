import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => {
  class NotConnected extends Error {}
  return { NotConnected, requireAdminScope: vi.fn(), planGate: vi.fn(), enabled: vi.fn(), importOrders: vi.fn() }
})
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: m.requireAdminScope }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: m.planGate }))
vi.mock('@/lib/integrations/resolve', () => ({ IntegrationNotConnectedError: m.NotConnected }))
vi.mock('@/lib/amazon/orders', () => ({ ordersEnabled: m.enabled, importAmazonOrders: m.importOrders }))

import { POST } from '@admin/app/api/(admin)/admin/amazon/orders/import/route'

const ADMIN = { adminId: 'a1', email: 'owner@crm.test', role: 'staff', scopes: ['amazon_orders:write'] }
const post = () => POST(new NextRequest('https://acme.jeffistores.in/api/admin/amazon/orders/import', { method: 'POST' }))

beforeEach(() => {
  vi.clearAllMocks()
  m.requireAdminScope.mockResolvedValue(ADMIN)
  m.planGate.mockResolvedValue({ allowed: true, plan: 'pro', upgradeRequired: null })
  m.enabled.mockResolvedValue(true)
  m.importOrders.mockResolvedValue({ imported: 3, skipped: 1 })
})

describe('amazon orders import route', () => {
  it('needs amazon_orders:write and the plan, importing nothing without them', async () => {
    m.requireAdminScope.mockResolvedValue(NextResponse.json({ error: 'nope' }, { status: 403 }))
    expect((await post()).status).toBe(403)
    expect(m.requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'amazon_orders:write')
    m.requireAdminScope.mockResolvedValue(ADMIN)
    m.planGate.mockResolvedValue({ allowed: false, plan: 'growth', upgradeRequired: 'pro' })
    expect((await post()).status).toBe(403)
    expect(m.importOrders).not.toHaveBeenCalled()
  })

  it('refuses with 409 while order import is switched off', async () => {
    m.enabled.mockResolvedValue(false)
    const res = await post()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Turn on Amazon order import first.')
    expect(m.importOrders).not.toHaveBeenCalled()
  })

  it('imports the orders and returns the counts', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ imported: 3, skipped: 1 })
    expect(m.importOrders).toHaveBeenCalledTimes(1)
  })

  it('maps Amazon failures: not connected 409, upstream 502', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    m.importOrders.mockRejectedValueOnce(new m.NotConnected('x'))
    expect((await post()).status).toBe(409)
    m.importOrders.mockRejectedValueOnce(Object.assign(new Error('Amazon down'), { httpStatus: 502 }))
    const res = await post()
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('Amazon down')
  })
})
