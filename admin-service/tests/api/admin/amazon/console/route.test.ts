import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => {
  class NotConnected extends Error {}
  return { NotConnected, requireAdminScope: vi.fn(), planGate: vi.fn(), load: vi.fn() }
})
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: m.requireAdminScope }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: m.planGate }))
vi.mock('@/lib/integrations/resolve', () => ({ IntegrationNotConnectedError: m.NotConnected }))
vi.mock('@/lib/amazon/console', () => ({ AMAZON_TABS: ['overview', 'listings', 'pricing'], loadAmazonTab: m.load }))

import { GET } from '@admin/app/api/(admin)/admin/amazon/console/route'

const ADMIN = { adminId: 'a1', email: 'owner@crm.test', role: 'staff', scopes: ['amazon:read'] }
const get = (qs = '') => GET(new NextRequest(`https://acme.jeffistores.in/api/admin/amazon/console${qs}`))

beforeEach(() => {
  vi.clearAllMocks()
  m.requireAdminScope.mockResolvedValue(ADMIN)
  m.planGate.mockResolvedValue({ allowed: true, plan: 'pro', upgradeRequired: null })
  m.load.mockResolvedValue({ kpis: [1] })
})

describe('amazon console route', () => {
  it('needs amazon:read and the plan', async () => {
    m.requireAdminScope.mockResolvedValue(NextResponse.json({ error: 'nope' }, { status: 403 }))
    expect((await get()).status).toBe(403)
    expect(m.requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'amazon:read')
    m.requireAdminScope.mockResolvedValue(ADMIN)
    m.planGate.mockResolvedValue({ allowed: false, plan: 'growth', upgradeRequired: 'pro' })
    expect((await get()).status).toBe(403)
    expect(m.load).not.toHaveBeenCalled()
  })

  it('loads the overview tab by default and the named tab when asked', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { kpis: [1] } })
    expect(m.load).toHaveBeenLastCalledWith('overview')
    await get('?tab=pricing')
    expect(m.load).toHaveBeenLastCalledWith('pricing')
  })

  it('rejects an unknown tab with 400', async () => {
    const res = await get('?tab=secrets')
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Unknown tab')
    expect(m.load).not.toHaveBeenCalled()
  })

  it('answers 409 when Amazon is not connected and 502 when it fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    m.load.mockRejectedValueOnce(new m.NotConnected('x'))
    const nc = await get('?tab=listings')
    expect(nc.status).toBe(409)
    expect((await nc.json()).error).toBe('Connect Amazon first.')
    m.load.mockRejectedValueOnce(Object.assign(new Error('Amazon down'), { httpStatus: 500 }))
    expect((await get()).status).toBe(502)
  })
})
