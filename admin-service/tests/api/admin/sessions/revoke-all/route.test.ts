import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/auth-sessions', () => ({ revokeAllForPrincipal: vi.fn() }))
vi.mock('@/lib/auth/api-tokens', () => ({ revokeAllForAdmin: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ getCurrentTenant: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/sessions/revoke-all/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { revokeAllForPrincipal } from '@/lib/auth/auth-sessions'
import { revokeAllForAdmin } from '@/lib/auth/api-tokens'
import { getCurrentTenant } from '@/lib/tenancy/tenant-context'

const mockAuth = vi.mocked(authenticateAdmin)
const admin = { adminId: 'a1', username: 'admin', role: 'admin', scopes: [] }
const req = (headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/admin/sessions/revoke-all', { method: 'POST', headers })

describe('POST /api/admin/sessions/revoke-all', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getCurrentTenant).mockReturnValue(undefined as never)
  })

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    expect((await POST(req())).status).toBe(401)
    expect(revokeAllForPrincipal).not.toHaveBeenCalled()
  })

  it('revokes sessions and tokens for the caller only', async () => {
    mockAuth.mockResolvedValue(admin)
    vi.mocked(revokeAllForPrincipal).mockResolvedValue(3 as never)
    vi.mocked(revokeAllForAdmin).mockResolvedValue(2 as never)
    const res = await POST(req({ 'x-tenant-id': 't1' }))
    expect(await res.json()).toEqual({ success: true, revoked: 3, tokensRevoked: 2 })
    expect(revokeAllForPrincipal).toHaveBeenCalledWith('admin', 'a1')
    expect(revokeAllForAdmin).toHaveBeenCalledWith('t1', 'a1')
  })

  it('prefers the tenant context over the header', async () => {
    mockAuth.mockResolvedValue(admin)
    vi.mocked(getCurrentTenant).mockReturnValue({ tenantId: 'ctx' } as never)
    vi.mocked(revokeAllForPrincipal).mockResolvedValue(1 as never)
    await POST(req({ 'x-tenant-id': 't1' }))
    expect(revokeAllForAdmin).toHaveBeenCalledWith('ctx', 'a1')
  })

  it('still succeeds with 0 tokens when token revocation fails', async () => {
    mockAuth.mockResolvedValue(admin)
    vi.mocked(revokeAllForPrincipal).mockResolvedValue(1 as never)
    vi.mocked(revokeAllForAdmin).mockRejectedValue(new Error('x'))
    const res = await POST(req())
    expect(await res.json()).toEqual({ success: true, revoked: 1, tokensRevoked: 0 })
  })
})
