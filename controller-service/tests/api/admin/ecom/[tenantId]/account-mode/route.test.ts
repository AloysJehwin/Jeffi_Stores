import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const auth = vi.hoisted(() => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => auth)
const reg = vi.hoisted(() => ({ getTenant: vi.fn(), setOwnRazorpay: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => reg)
const keys = vi.hoisted(() => ({ storedRazorpayKeys: vi.fn() }))
vi.mock('@/lib/integrations/resolve', () => keys)

import { PATCH } from '@controller/app/api/(admin)/admin/ecom/[tenantId]/account-mode/route'

const call = (body: unknown) =>
  PATCH(new NextRequest('http://localhost/api/admin/ecom/t-1/account-mode', { method: 'PATCH', body: typeof body === 'string' ? body : JSON.stringify(body) }), {
    params: Promise.resolve({ tenantId: 't-1' }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-1', email: 'op@example.com', role: 'administrator', scopes: [] })
  reg.getTenant.mockResolvedValue({ id: 't-1', slug: 'acme' })
  keys.storedRazorpayKeys.mockResolvedValue({ keyId: 'k' })
})

describe('PATCH /api/admin/ecom/[tenantId]/account-mode', () => {
  it('401s when unauthenticated', async () => {
    auth.authenticateAdmin.mockResolvedValue(null)
    expect((await call({ own_razorpay: true })).status).toBe(401)
    expect(reg.setOwnRazorpay).not.toHaveBeenCalled()
  })

  it('403s for a non-administrator', async () => {
    auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-2', role: 'super_admin', scopes: ['ecom_customers:write'] })
    expect((await call({ own_razorpay: true })).status).toBe(403)
    expect(reg.setOwnRazorpay).not.toHaveBeenCalled()
  })

  it('404s for an unknown tenant', async () => {
    reg.getTenant.mockResolvedValue(null)
    expect((await call({ own_razorpay: true })).status).toBe(404)
  })

  it('400s for a bad body', async () => {
    expect((await call({ own_razorpay: 'yes' })).status).toBe(400)
    expect((await call('not json')).status).toBe(400)
  })

  it('refuses own-Razorpay without connected credentials', async () => {
    keys.storedRazorpayKeys.mockResolvedValue(null)
    const res = await call({ own_razorpay: true })
    expect(res.status).toBe(409)
    expect(reg.setOwnRazorpay).not.toHaveBeenCalled()
  })

  it('treats a failing key lookup as no credentials', async () => {
    keys.storedRazorpayKeys.mockRejectedValue(new Error('decrypt'))
    expect((await call({ own_razorpay: true })).status).toBe(409)
  })

  it('enables own-Razorpay when keys are connected', async () => {
    const res = await call({ own_razorpay: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, own_razorpay: true })
    expect(reg.setOwnRazorpay).toHaveBeenCalledWith('t-1', true)
  })

  it('turns it off without checking keys', async () => {
    const res = await call({ own_razorpay: false })
    expect(res.status).toBe(200)
    expect(keys.storedRazorpayKeys).not.toHaveBeenCalled()
    expect(reg.setOwnRazorpay).toHaveBeenCalledWith('t-1', false)
  })
})
