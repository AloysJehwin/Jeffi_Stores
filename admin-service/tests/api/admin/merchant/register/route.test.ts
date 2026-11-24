import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => ({ requireAdminScope: vi.fn(), register: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: m.requireAdminScope }))
vi.mock('@/lib/merchant/registration', () => ({ registerConnectedMerchant: m.register }))

import { POST } from '@admin/app/api/(admin)/admin/merchant/register/route'

const ADMIN = { adminId: 'a1', email: 'owner@crm.test', role: 'staff', scopes: ['merchant_sync:write'] }
const post = (body: unknown) =>
  POST(new NextRequest('https://acme.jeffistores.in/api/admin/merchant/register', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json' } }))

beforeEach(() => {
  vi.clearAllMocks()
  m.requireAdminScope.mockResolvedValue(ADMIN)
  m.register.mockResolvedValue({ ok: true, message: 'Registered' })
})

describe('merchant register route', () => {
  it('needs merchant_sync:write and registers nothing without it', async () => {
    m.requireAdminScope.mockResolvedValue(NextResponse.json({ error: 'nope' }, { status: 403 }))
    expect((await post({})).status).toBe(403)
    expect(m.requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'merchant_sync:write')
    m.requireAdminScope.mockResolvedValue(NextResponse.json({ error: 'nope' }, { status: 401 }))
    expect((await post({})).status).toBe(401)
    expect(m.register).not.toHaveBeenCalled()
  })

  it('rejects a malformed email with 400 before Google is called', async () => {
    const res = await post({ email: 'not-an-email' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ ok: false, message: 'Enter a valid email' })
    expect(m.register).not.toHaveBeenCalled()
  })

  it('registers with the trimmed email', async () => {
    const res = await post({ email: '  dev@crm.test ' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, message: 'Registered' })
    expect(m.register).toHaveBeenCalledWith('dev@crm.test')
  })

  it('registers with no email when none is given or the body is unreadable', async () => {
    await post({})
    expect(m.register).toHaveBeenLastCalledWith(null)
    await post('not json')
    expect(m.register).toHaveBeenLastCalledWith(null)
  })

  it('answers 400 with Google\'s message when registration fails', async () => {
    m.register.mockResolvedValue({ ok: false, message: 'Merchant Center account not linked' })
    const res = await post({})
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ ok: false, message: 'Merchant Center account not linked' })
  })
})
