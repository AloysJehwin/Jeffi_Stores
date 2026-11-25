import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn(), isPlatformOwner: vi.fn() }))
vi.mock('@/lib/auth/auth-sessions', () => ({ revokeAllForPrincipal: vi.fn() }))
vi.mock('@/lib/auth/api-tokens', () => ({ revokeAllForAdmin: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ getCurrentTenant: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/users/[id]/revoke-sessions/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope, isPlatformOwner } from '@/lib/auth/scopes'
import { revokeAllForPrincipal } from '@/lib/auth/auth-sessions'
import { revokeAllForAdmin } from '@/lib/auth/api-tokens'
import { queryMany } from '@/lib/shared/db'
import { getCurrentTenant } from '@/lib/tenancy/tenant-context'

const mockAuth = vi.mocked(authenticateAdmin)
const admin = { adminId: 'a1', username: 'admin', role: 'admin', scopes: [] }
const call = (qs = '') =>
  POST(
    new NextRequest(`http://localhost/api/admin/users/u1/revoke-sessions${qs}`, {
      method: 'POST',
      headers: { 'x-tenant-id': 't1' },
    }),
    { params: Promise.resolve({ id: 'u1' }) }
  )

describe('POST /api/admin/users/[id]/revoke-sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getCurrentTenant).mockReturnValue(undefined as never)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(isPlatformOwner).mockReturnValue(false)
    vi.mocked(revokeAllForPrincipal).mockResolvedValue(2 as never)
  })

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
  })

  it('returns 400 for an unknown type', async () => {
    mockAuth.mockResolvedValue(admin)
    expect((await call('?type=admin')).status).toBe(400)
    expect(revokeAllForPrincipal).not.toHaveBeenCalled()
  })

  it('returns 403 without customers:write for the default type', async () => {
    mockAuth.mockResolvedValue(admin)
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await call()).status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith('admin', [], 'customers:write')
    expect(revokeAllForPrincipal).not.toHaveBeenCalled()
  })

  it('requires business_customers:write for type=business', async () => {
    mockAuth.mockResolvedValue(admin)
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await call('?type=business')).status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith('admin', [], 'business_customers:write')
  })

  it('revokes customer sessions without touching tokens for a non-owner', async () => {
    mockAuth.mockResolvedValue(admin)
    const res = await call()
    expect(await res.json()).toEqual({ success: true, revoked: 2, tokensRevoked: 0 })
    expect(revokeAllForPrincipal).toHaveBeenCalledWith('customer', 'u1')
    expect(revokeAllForAdmin).not.toHaveBeenCalled()
  })

  it('also revokes CLI tokens of linked admins for a platform owner', async () => {
    mockAuth.mockResolvedValue(admin)
    vi.mocked(isPlatformOwner).mockReturnValue(true)
    vi.mocked(queryMany).mockResolvedValue([{ id: 'x1' }, { id: 'x2' }])
    vi.mocked(revokeAllForAdmin).mockResolvedValue(1 as never)
    const res = await call('?type=business')
    expect(await res.json()).toEqual({ success: true, revoked: 2, tokensRevoked: 2 })
    expect(revokeAllForPrincipal).toHaveBeenCalledWith('business', 'u1')
    expect(revokeAllForAdmin).toHaveBeenCalledWith('t1', 'x1')
    expect(revokeAllForAdmin).toHaveBeenCalledWith('t1', 'x2')
  })

  it('tolerates a failing admin lookup for a platform owner', async () => {
    mockAuth.mockResolvedValue(admin)
    vi.mocked(isPlatformOwner).mockReturnValue(true)
    vi.mocked(queryMany).mockRejectedValue(new Error('db'))
    const res = await call()
    expect(await res.json()).toEqual({ success: true, revoked: 2, tokensRevoked: 0 })
  })
})
