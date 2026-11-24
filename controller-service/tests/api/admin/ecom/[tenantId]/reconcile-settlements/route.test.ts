import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const auth = vi.hoisted(() => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => auth)
const reg = vi.hoisted(() => ({ getTenant: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => reg)
const settle = vi.hoisted(() => ({ reconcileCapturedTransactions: vi.fn() }))
vi.mock('@/lib/payments/route-settlement', () => settle)

import { POST } from '@controller/app/api/(admin)/admin/ecom/[tenantId]/reconcile-settlements/route'

const call = () =>
  POST(new NextRequest('http://localhost/api/admin/ecom/t-1/reconcile-settlements', { method: 'POST' }), { params: Promise.resolve({ tenantId: 't-1' }) })

beforeEach(() => {
  vi.clearAllMocks()
  auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-1', role: 'administrator', scopes: [] })
  reg.getTenant.mockResolvedValue({ id: 't-1' })
  settle.reconcileCapturedTransactions.mockResolvedValue({ settled: 3 })
})

describe('POST /api/admin/ecom/[tenantId]/reconcile-settlements', () => {
  it('401s when unauthenticated', async () => {
    auth.authenticateAdmin.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
  })

  it('403s for a non-administrator', async () => {
    auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-2', role: 'super_admin', scopes: [] })
    expect((await call()).status).toBe(403)
    expect(settle.reconcileCapturedTransactions).not.toHaveBeenCalled()
  })

  it('404s for an unknown tenant', async () => {
    reg.getTenant.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
  })

  it('settles this tenant\'s rows with no age floor', async () => {
    const res = await call()
    expect(await res.json()).toEqual({ settled: 3 })
    expect(settle.reconcileCapturedTransactions).toHaveBeenCalledWith({ tenantId: 't-1', olderThanMinutes: 0, limit: 500 })
  })
})
