import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => ({ requireAdminScope: vi.fn(), planGate: vi.fn(), list: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: m.requireAdminScope }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: m.planGate }))
vi.mock('@/lib/channels/sync-run', async importOriginal => ({ ...(await importOriginal<any>()), listRuns: m.list }))

import { GET } from '@admin/app/api/(admin)/admin/channels/[channel]/runs/route'

const ADMIN = { adminId: 'a1', email: 'owner@crm.test', role: 'staff', scopes: ['flipkart:read'] }
const get = (channel: string) => GET(new NextRequest(`https://acme.jeffistores.in/api/admin/channels/${channel}/runs`), { params: Promise.resolve({ channel }) })

beforeEach(() => {
  vi.clearAllMocks()
  m.requireAdminScope.mockResolvedValue(ADMIN)
  m.planGate.mockResolvedValue({ allowed: true, plan: 'pro', upgradeRequired: null })
  m.list.mockResolvedValue([{ id: '3', job: 'flipkart_stock', status: 'success' }])
})

describe('channels runs route', () => {
  it('answers 404 for an unknown channel', async () => {
    expect((await get('tiktok')).status).toBe(404)
    expect(m.list).not.toHaveBeenCalled()
  })

  it("needs the channel's read scope and plan", async () => {
    m.requireAdminScope.mockResolvedValue(NextResponse.json({ error: 'nope' }, { status: 403 }))
    expect((await get('flipkart')).status).toBe(403)
    expect(m.requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'flipkart:read')
    m.requireAdminScope.mockResolvedValue(ADMIN)
    m.planGate.mockResolvedValue({ allowed: false, plan: 'growth', upgradeRequired: 'pro' })
    expect((await get('flipkart')).status).toBe(403)
    expect(m.list).not.toHaveBeenCalled()
  })

  it('lists the recent sync runs of the channel in the URL', async () => {
    const res = await get('flipkart')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ runs: [{ id: '3', job: 'flipkart_stock', status: 'success' }] })
    expect(m.list).toHaveBeenCalledWith('flipkart')
  })
})
