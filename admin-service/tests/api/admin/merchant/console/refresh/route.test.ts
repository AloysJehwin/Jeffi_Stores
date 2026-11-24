import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => {
  class NotConnected extends Error {}
  return { NotConnected, requireAdminScope: vi.fn(), planGate: vi.fn(), reports: vi.fn(), status: vi.fn(), alerts: vi.fn() }
})
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: m.requireAdminScope }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: m.planGate }))
vi.mock('@/lib/integrations/resolve', () => ({ IntegrationNotConnectedError: m.NotConnected }))
vi.mock('@/lib/merchant/reports', () => ({ refreshMerchantReports: m.reports }))
vi.mock('@/lib/merchant/gmc-status', () => ({ refreshGmcStatusSnapshot: m.status }))
vi.mock('@/lib/channels/alerts-engine', () => ({ runChannelAlerts: m.alerts }))
vi.mock('@/lib/merchant/alerts', () => ({ GMC_RULES: { id: 'gmc-rules' } }))

import { POST } from '@admin/app/api/(admin)/admin/merchant/console/refresh/route'

const ADMIN = { adminId: 'a1', email: 'owner@crm.test', role: 'staff', scopes: ['merchant_sync:write'] }
const post = (body: unknown) =>
  POST(new NextRequest('https://acme.jeffistores.in/api/admin/merchant/console/refresh', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }))

beforeEach(() => {
  vi.clearAllMocks()
  m.requireAdminScope.mockResolvedValue(ADMIN)
  m.planGate.mockResolvedValue({ allowed: true, plan: 'pro', upgradeRequired: null })
  m.alerts.mockResolvedValue({ raised: 1 })
  m.reports.mockResolvedValue({ status: 'success', reports: 4 })
  m.status.mockResolvedValue({ products: 50 })
})

describe('merchant console refresh route', () => {
  it('needs merchant_sync:write and the plan, refreshing nothing without them', async () => {
    m.requireAdminScope.mockResolvedValue(NextResponse.json({ error: 'nope' }, { status: 403 }))
    expect((await post({})).status).toBe(403)
    expect(m.requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'merchant_sync:write')
    m.requireAdminScope.mockResolvedValue(ADMIN)
    m.planGate.mockResolvedValue({ allowed: false, plan: 'growth', upgradeRequired: 'pro' })
    const res = await post({})
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Google Merchant needs the Pro plan.')
    expect(m.reports).not.toHaveBeenCalled()
    expect(m.status).not.toHaveBeenCalled()
  })

  it('refreshes the reports by default, then runs the alert rules', async () => {
    const res = await post({})
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'success', reports: 4, alerts: { raised: 1 } })
    expect(m.alerts).toHaveBeenCalledWith({ id: 'gmc-rules' })
    expect(m.status).not.toHaveBeenCalled()
  })

  it('refreshes the product status snapshot for kind=status', async () => {
    const res = await post({ kind: 'status' })
    expect(await res.json()).toEqual({ status: 'success', summary: { products: 50 }, alerts: { raised: 1 } })
    expect(m.reports).not.toHaveBeenCalled()
  })

  it('answers 409 when a status refresh is already running', async () => {
    m.status.mockResolvedValue({ locked: true })
    const res = await post({ kind: 'status' })
    expect(res.status).toBe(409)
    expect(m.alerts).not.toHaveBeenCalled()
  })

  it('maps Google failures: not connected 409, upstream 502', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    m.reports.mockRejectedValueOnce(new m.NotConnected('x'))
    const nc = await post({})
    expect(nc.status).toBe(409)
    expect((await nc.json()).error).toBe('Connect Google Merchant Center first.')
    m.status.mockRejectedValueOnce(Object.assign(new Error('Merchant API down'), { httpStatus: 503 }))
    expect((await post({ kind: 'status' })).status).toBe(502)
  })
})
