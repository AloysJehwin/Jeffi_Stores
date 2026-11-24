import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => ({ requireAdminScope: vi.fn(), planGate: vi.fn(), dismiss: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: m.requireAdminScope }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: m.planGate }))
vi.mock('@/lib/channels/alerts-engine', () => ({ dismissChannelAlert: m.dismiss }))

import { DELETE } from '@admin/app/api/(admin)/admin/channels/[channel]/alerts/[id]/route'

const WRITER = { adminId: 'a1', email: 'owner@crm.test', role: 'staff', scopes: ['amazon:read', 'amazon:write'] }
const READER = { ...WRITER, scopes: ['amazon:read'] }
const del = (channel: string, id: string) =>
  DELETE(new NextRequest(`https://acme.jeffistores.in/api/admin/channels/${channel}/alerts/${id}`, { method: 'DELETE' }), { params: Promise.resolve({ channel, id }) })

beforeEach(() => {
  vi.clearAllMocks()
  m.requireAdminScope.mockResolvedValue(WRITER)
  m.planGate.mockResolvedValue({ allowed: true, plan: 'pro', upgradeRequired: null })
  m.dismiss.mockResolvedValue(true)
})

describe('channels alerts/[id] route', () => {
  it('answers 404 for an unknown channel or a non-numeric id before any auth work', async () => {
    expect((await del('tiktok', '4')).status).toBe(404)
    expect((await del('amazon', 'abc')).status).toBe(404)
    expect(m.requireAdminScope).not.toHaveBeenCalled()
    expect(m.dismiss).not.toHaveBeenCalled()
  })

  it("needs the channel's read scope and its plan", async () => {
    m.requireAdminScope.mockResolvedValue(NextResponse.json({ error: 'nope' }, { status: 403 }))
    expect((await del('amazon', '4')).status).toBe(403)
    expect(m.requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'amazon:read')
    m.requireAdminScope.mockResolvedValue(NextResponse.json({ error: 'nope' }, { status: 401 }))
    expect((await del('amazon', '4')).status).toBe(401)
    m.requireAdminScope.mockResolvedValue(WRITER)
    m.planGate.mockResolvedValue({ allowed: false, plan: 'growth', upgradeRequired: 'pro' })
    const res = await del('amazon', '4')
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Amazon needs the Pro plan.')
    expect(m.dismiss).not.toHaveBeenCalled()
  })

  it("needs the channel's write scope to dismiss", async () => {
    m.requireAdminScope.mockResolvedValue(READER)
    const res = await del('amazon', '4')
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Insufficient permissions')
    expect(m.dismiss).not.toHaveBeenCalled()
  })

  it('checks the write scope of the channel in the URL', async () => {
    m.requireAdminScope.mockResolvedValue({ ...WRITER, scopes: ['flipkart:read', 'amazon:write'] })
    expect((await del('flipkart', '9')).status).toBe(403)
    m.requireAdminScope.mockResolvedValue({ ...WRITER, scopes: ['flipkart:read', 'flipkart:write'] })
    expect((await del('flipkart', '9')).status).toBe(200)
    expect(m.requireAdminScope).toHaveBeenLastCalledWith(expect.anything(), 'flipkart:read')
  })

  it('dismisses an open alert, recording who did it', async () => {
    const res = await del('amazon', '42')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(m.dismiss).toHaveBeenCalledWith('amazon', '42', 'owner@crm.test')
  })

  it('answers 404 when the alert is gone or already dismissed', async () => {
    m.dismiss.mockResolvedValue(false)
    const res = await del('amazon', '42')
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Alert not found or not open')
  })
})
