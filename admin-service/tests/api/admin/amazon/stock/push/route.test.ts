import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => {
  class NotConnected extends Error {}
  return { NotConnected, requireAdminScope: vi.fn(), planGate: vi.fn(), settings: vi.fn(), push: vi.fn() }
})
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: m.requireAdminScope }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: m.planGate }))
vi.mock('@/lib/integrations/resolve', () => ({ IntegrationNotConnectedError: m.NotConnected }))
vi.mock('@/lib/amazon/stock', () => ({ stockSettings: m.settings, pushAmazonStock: m.push }))

import { POST } from '@admin/app/api/(admin)/admin/amazon/stock/push/route'

const ADMIN = { adminId: 'a1', email: 'owner@crm.test', role: 'staff', scopes: ['amazon_orders:write'] }
const post = () => POST(new NextRequest('https://acme.jeffistores.in/api/admin/amazon/stock/push', { method: 'POST' }))

beforeEach(() => {
  vi.clearAllMocks()
  m.requireAdminScope.mockResolvedValue(ADMIN)
  m.planGate.mockResolvedValue({ allowed: true, plan: 'pro', upgradeRequired: null })
  m.settings.mockResolvedValue({ enabled: true, buffer: 1 })
  m.push.mockResolvedValue({ status: 'success', pushed: 7 })
})

describe('amazon stock push route', () => {
  it('needs amazon_orders:write and the plan, pushing nothing without them', async () => {
    m.requireAdminScope.mockResolvedValue(NextResponse.json({ error: 'nope' }, { status: 403 }))
    expect((await post()).status).toBe(403)
    expect(m.requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'amazon_orders:write')
    m.requireAdminScope.mockResolvedValue(ADMIN)
    m.planGate.mockResolvedValue({ allowed: false, plan: 'growth', upgradeRequired: 'pro' })
    const res = await post()
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Amazon stock needs the Pro plan.')
    expect(m.push).not.toHaveBeenCalled()
  })

  it('refuses with 409 while stock push is switched off', async () => {
    m.settings.mockResolvedValue({ enabled: false, buffer: 0 })
    const res = await post()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Turn on stock push first.')
    expect(m.push).not.toHaveBeenCalled()
  })

  it('pushes stock to Amazon and returns the run summary', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'success', pushed: 7 })
    expect(m.push).toHaveBeenCalledTimes(1)
  })

  it('maps Amazon failures: not connected 409, upstream 502', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    m.push.mockRejectedValueOnce(new m.NotConnected('x'))
    expect((await post()).status).toBe(409)
    m.push.mockRejectedValueOnce(Object.assign(new Error('Amazon down'), { httpStatus: 503 }))
    const res = await post()
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('Amazon down')
  })
})
