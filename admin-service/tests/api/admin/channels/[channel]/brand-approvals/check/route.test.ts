import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => {
  class NotConnected extends Error {}
  return { NotConnected, requireAdminScope: vi.fn(), planGate: vi.fn(), check: vi.fn(), restrictions: vi.fn() }
})
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: m.requireAdminScope }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: m.planGate }))
vi.mock('@/lib/integrations/resolve', () => ({ IntegrationNotConnectedError: m.NotConnected }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(async () => []) }))
vi.mock('@/lib/amazon/client', () => ({ getListingsRestrictions: m.restrictions }))
vi.mock('@/lib/channels/brand-approvals', async importOriginal => ({ ...(await importOriginal<any>()), checkAmazonBrandApprovals: m.check }))

import { POST } from '@admin/app/api/(admin)/admin/channels/[channel]/brand-approvals/check/route'

const BRAND = '11111111-1111-4111-8111-111111111111'
const WRITER = { adminId: 'a1', email: 'owner@crm.test', role: 'staff', scopes: ['amazon:read', 'amazon:write'] }
const post = (channel: string, body: unknown = {}) =>
  POST(new NextRequest(`https://acme.jeffistores.in/api/admin/channels/${channel}/brand-approvals/check`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json' } }), {
    params: Promise.resolve({ channel }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  m.requireAdminScope.mockResolvedValue(WRITER)
  m.planGate.mockResolvedValue({ allowed: true, plan: 'pro', upgradeRequired: null })
  m.check.mockResolvedValue({ checked: 2, approved: 1, needsApproval: 1 })
  m.restrictions.mockResolvedValue([])
})

describe('channels brand-approvals check route', () => {
  it('is Amazon only: other channels answer 404 without any auth work', async () => {
    for (const channel of ['myntra', 'gmc', 'tiktok']) expect((await post(channel)).status).toBe(404)
    expect(m.requireAdminScope).not.toHaveBeenCalled()
    expect(m.check).not.toHaveBeenCalled()
  })

  it('needs amazon:read, the plan and amazon:write, asking Amazon nothing without them', async () => {
    m.requireAdminScope.mockResolvedValue(NextResponse.json({ error: 'nope' }, { status: 403 }))
    expect((await post('amazon')).status).toBe(403)
    expect(m.requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'amazon:read')
    m.requireAdminScope.mockResolvedValue({ ...WRITER, scopes: ['amazon:read'] })
    const res = await post('amazon')
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Insufficient permissions')
    m.requireAdminScope.mockResolvedValue(WRITER)
    m.planGate.mockResolvedValue({ allowed: false, plan: 'growth', upgradeRequired: 'pro' })
    expect((await post('amazon')).status).toBe(403)
    expect(m.check).not.toHaveBeenCalled()
  })

  it('checks every brand with the Listings Restrictions API and returns the result', async () => {
    const res = await post('amazon')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, checked: 2, approved: 1, needsApproval: 1 })
    const [lookup, opts] = m.check.mock.calls[0]
    expect(opts).toEqual({ brandIds: undefined })
    await lookup('B000TEST01')
    expect(m.restrictions).toHaveBeenCalledWith('B000TEST01')
  })

  it('limits the check to the brands in the body, and tolerates an unreadable body', async () => {
    await post('amazon', { brandIds: [BRAND] })
    expect(m.check.mock.calls[0][1]).toEqual({ brandIds: [BRAND] })
    const res = await post('amazon', 'not json')
    expect(res.status).toBe(200)
    expect(m.check.mock.calls[1][1]).toEqual({ brandIds: undefined })
  })

  it('maps Amazon failures: not connected 409, upstream 502', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    m.check.mockRejectedValueOnce(new m.NotConnected('x'))
    const nc = await post('amazon')
    expect(nc.status).toBe(409)
    expect((await nc.json()).error).toBe('Connect Amazon Seller first.')
    m.check.mockRejectedValueOnce(Object.assign(new Error('SP-API down'), { httpStatus: 503 }))
    const down = await post('amazon')
    expect(down.status).toBe(502)
    expect((await down.json()).error).toBe('SP-API down')
  })
})
