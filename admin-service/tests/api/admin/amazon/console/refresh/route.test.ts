import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => {
  class NotConnected extends Error {}
  return {
    NotConnected,
    requireAdminScope: vi.fn(),
    planGate: vi.fn(),
    offers: vi.fn(),
    fees: vi.fn(),
    status: vi.fn(),
    reports: vi.fn(),
    alerts: vi.fn(),
  }
})
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: m.requireAdminScope }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: m.planGate }))
vi.mock('@/lib/integrations/resolve', () => ({ IntegrationNotConnectedError: m.NotConnected }))
vi.mock('@/lib/channels/alerts-engine', () => ({ runChannelAlerts: m.alerts }))
vi.mock('@/lib/amazon/alerts', () => ({ AMAZON_RULES: { id: 'amazon-rules' } }))
vi.mock('@/lib/amazon/console', () => ({ refreshOffers: m.offers, refreshFees: m.fees }))
vi.mock('@/lib/amazon/status', () => ({ refreshAmazonStatusSnapshot: m.status }))
vi.mock('@/lib/amazon/reports', () => ({ runAmazonReports: m.reports }))

import { POST } from '@admin/app/api/(admin)/admin/amazon/console/refresh/route'

const ADMIN = { adminId: 'a1', email: 'owner@crm.test', role: 'staff', scopes: ['amazon:write'] }
const post = (body: unknown) =>
  POST(new NextRequest('https://acme.jeffistores.in/api/admin/amazon/console/refresh', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }))

beforeEach(() => {
  vi.clearAllMocks()
  m.requireAdminScope.mockResolvedValue(ADMIN)
  m.planGate.mockResolvedValue({ allowed: true, plan: 'pro', upgradeRequired: null })
  m.alerts.mockResolvedValue({ raised: 0 })
  m.offers.mockResolvedValue({ status: 'success', offers: 4 })
  m.fees.mockResolvedValue({ status: 'success', fees: 9 })
  m.status.mockResolvedValue({ listings: 12 })
  m.reports.mockResolvedValue({ status: 'success', reports: 2 })
})

describe('amazon console refresh route', () => {
  it('needs amazon:write and the plan, and refreshes nothing without them', async () => {
    m.requireAdminScope.mockResolvedValue(NextResponse.json({ error: 'nope' }, { status: 403 }))
    expect((await post({ kind: 'offers' })).status).toBe(403)
    expect(m.requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'amazon:write')
    m.requireAdminScope.mockResolvedValue(ADMIN)
    m.planGate.mockResolvedValue({ allowed: false, plan: 'growth', upgradeRequired: 'pro' })
    expect((await post({ kind: 'offers' })).status).toBe(403)
    for (const f of [m.offers, m.fees, m.status, m.reports]) expect(f).not.toHaveBeenCalled()
  })

  it('rejects an unknown kind with 400', async () => {
    const res = await post({ kind: 'everything' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Unknown refresh')
    expect((await post({})).status).toBe(400)
    for (const f of [m.offers, m.fees, m.status, m.reports]) expect(f).not.toHaveBeenCalled()
  })

  it('refreshes Buy Box offers, then runs the alert rules', async () => {
    const res = await post({ kind: 'offers' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'success', offers: 4, alerts: { raised: 0 } })
    expect(m.offers).toHaveBeenCalledTimes(1)
    expect(m.alerts).toHaveBeenCalledWith({ id: 'amazon-rules' })
  })

  it('refreshes fee estimates and reports', async () => {
    expect(await (await post({ kind: 'fees' })).json()).toMatchObject({ fees: 9 })
    expect(m.fees).toHaveBeenCalledTimes(1)
    expect(await (await post({ kind: 'reports' })).json()).toMatchObject({ reports: 2 })
    expect(m.reports).toHaveBeenCalledTimes(1)
  })

  it('refreshes the listing status snapshot', async () => {
    const res = await post({ kind: 'status' })
    expect(await res.json()).toEqual({ status: 'success', summary: { listings: 12 }, alerts: { raised: 0 } })
    expect(m.status).toHaveBeenCalledTimes(1)
  })

  it('answers 409 when a status refresh is already running', async () => {
    m.status.mockResolvedValue({ locked: true })
    const res = await post({ kind: 'status' })
    expect(res.status).toBe(409)
    expect(m.alerts).not.toHaveBeenCalled()
  })

  it('maps Amazon failures: not connected 409, upstream 502', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    m.offers.mockRejectedValueOnce(new m.NotConnected('x'))
    expect((await post({ kind: 'offers' })).status).toBe(409)
    m.fees.mockRejectedValueOnce(Object.assign(new Error('Amazon down'), { httpStatus: 503 }))
    const res = await post({ kind: 'fees' })
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('Amazon down')
    expect(m.alerts).not.toHaveBeenCalled()
  })
})
