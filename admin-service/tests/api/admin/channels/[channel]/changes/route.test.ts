import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => ({ requireAdminScope: vi.fn(), planGate: vi.fn(), list: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: m.requireAdminScope }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: m.planGate }))
vi.mock('@/lib/channels/change-log', () => ({ listChanges: m.list }))

import { GET } from '@admin/app/api/(admin)/admin/channels/[channel]/changes/route'

const ADMIN = { adminId: 'a1', email: 'owner@crm.test', role: 'staff', scopes: ['ajio:read'] }
const get = (channel: string) => GET(new NextRequest(`https://acme.jeffistores.in/api/admin/channels/${channel}/changes`), { params: Promise.resolve({ channel }) })

beforeEach(() => {
  vi.clearAllMocks()
  m.requireAdminScope.mockResolvedValue(ADMIN)
  m.planGate.mockResolvedValue({ allowed: true, plan: 'pro', upgradeRequired: null })
  m.list.mockResolvedValue([{ id: '9', action: 'listings.submit' }])
})

describe('channels changes route', () => {
  it('answers 404 for an unknown channel', async () => {
    const res = await get('tiktok')
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Unknown channel')
    expect(m.list).not.toHaveBeenCalled()
  })

  it("needs the channel's read scope and plan", async () => {
    m.requireAdminScope.mockResolvedValue(NextResponse.json({ error: 'nope' }, { status: 403 }))
    expect((await get('ajio')).status).toBe(403)
    expect(m.requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'ajio:read')
    m.requireAdminScope.mockResolvedValue(NextResponse.json({ error: 'nope' }, { status: 401 }))
    expect((await get('ajio')).status).toBe(401)
    m.requireAdminScope.mockResolvedValue(ADMIN)
    m.planGate.mockResolvedValue({ allowed: false, plan: 'growth', upgradeRequired: 'pro' })
    const res = await get('ajio')
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('AJIO needs the Pro plan.')
    expect(m.list).not.toHaveBeenCalled()
  })

  it('lists the change log of the channel in the URL', async () => {
    const res = await get('ajio')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ changes: [{ id: '9', action: 'listings.submit' }] })
    expect(m.list).toHaveBeenCalledWith('ajio')
  })
})
