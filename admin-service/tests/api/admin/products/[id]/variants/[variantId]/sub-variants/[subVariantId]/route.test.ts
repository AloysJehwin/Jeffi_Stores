import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/orders/variant-status', () => ({ setSubVariantActive: vi.fn() }))

import { PATCH } from '@admin/app/api/(admin)/admin/products/[id]/variants/[variantId]/sub-variants/[subVariantId]/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { setSubVariantActive } from '@/lib/orders/variant-status'

const admin = { adminId: 'a1', username: 'a', role: 'admin', scopes: [] }
const call = (body: unknown) =>
  PATCH(new NextRequest('http://localhost/x', { method: 'PATCH', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: 'p1', variantId: 'v1', subVariantId: 'sv1' }),
  })

describe('PATCH /api/admin/products/[id]/variants/[variantId]/sub-variants/[subVariantId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
    vi.mocked(hasScope).mockReturnValue(true)
  })

  it('returns 401 and 403', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null)
    expect((await call({ is_active: true })).status).toBe(401)
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await call({ is_active: true })).status).toBe(403)
    expect(setSubVariantActive).not.toHaveBeenCalled()
  })

  it('returns 400 for a non-boolean is_active', async () => {
    expect((await call({ is_active: 1 })).status).toBe(400)
  })

  it('returns 404 when the sub-variant does not exist', async () => {
    vi.mocked(setSubVariantActive).mockResolvedValue(false as never)
    expect((await call({ is_active: true })).status).toBe(404)
  })

  it('switches the sub-variant on', async () => {
    vi.mocked(setSubVariantActive).mockResolvedValue(true as never)
    const res = await call({ is_active: true })
    expect(await res.json()).toEqual({ success: true, is_active: true })
    expect(setSubVariantActive).toHaveBeenCalledWith('p1', 'v1', 'sv1', true)
  })

  it('returns 500 when the update fails', async () => {
    vi.mocked(setSubVariantActive).mockRejectedValue(new Error('db'))
    expect((await call({ is_active: true })).status).toBe(500)
  })
})
