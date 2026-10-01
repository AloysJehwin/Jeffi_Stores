import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}))
vi.mock('@/lib/tenancy/request-tenant', () => ({ resolveRequestTenantId: vi.fn(async () => null) }))
vi.mock('@/lib/auth/scopes', () => ({
  ALL_SCOPE_KEYS: ['orders', 'products', 'invoices', 'inventory', 'mailer', 'customers'],
  isPlatformOwner: (role: string) => role === 'administrator' || role === 'super_admin',
  // A tenant may only hand out what its plan sells; off-tenant this is the full set.
  assignableScopeKeys: vi.fn(async () => [
    'products',
    'orders',
    'inventory',
    'financial',
    'customers',
    'mailer',
    'audit',
    'agent',
  ]),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { PATCH, DELETE } from '@/app/api/(admin)/admin/users/[id]/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { query, queryOne } from '@/lib/shared/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockQuery = vi.mocked(query)
const mockQueryOne = vi.mocked(queryOne)

// ── Helpers ───────────────────────────────────────────────────────────────────

const SUPER_ADMIN = { adminId: 'super-1', id: 'super-1', role: 'super_admin', scopes: [] }
const REGULAR_ADMIN = { adminId: 'admin-1', id: 'admin-1', role: 'admin', scopes: [] }

function makePatch(id: string, body: unknown) {
  return new NextRequest(`http://localhost/api/admin/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeDelete(id: string) {
  return new NextRequest(`http://localhost/api/admin/users/${id}`, {
    method: 'DELETE',
  })
}

const updatedAdmin = {
  id: 'target-1',
  username: 'targetadmin',
  role: 'admin',
  scopes: ['orders'],
  is_active: true,
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

describe('PATCH /api/admin/users/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(SUPER_ADMIN as any)
    mockQuery.mockResolvedValue({ rows: [] } as any)
  })

  it('returns 403 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null as any)
    const res = await PATCH(makePatch('target-1', { scopes: ['orders'] }), {
      params: Promise.resolve({ id: 'target-1' }),
    })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Unauthorized')
  })

  it('returns 403 when role is not super_admin', async () => {
    mockAuth.mockResolvedValue(REGULAR_ADMIN as any)
    const res = await PATCH(makePatch('target-1', { scopes: ['orders'] }), {
      params: Promise.resolve({ id: 'target-1' }),
    })
    expect(res.status).toBe(403)
  })

  it('returns 400 when no fields to update', async () => {
    const res = await PATCH(makePatch('target-1', {}), { params: Promise.resolve({ id: 'target-1' }) })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('No fields to update')
  })

  it('returns 400 for invalid scopes', async () => {
    const res = await PATCH(makePatch('target-1', { scopes: ['invalid-scope'] }), {
      params: Promise.resolve({ id: 'target-1' }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid scopes')
  })

  it('returns 400 for non-array scopes', async () => {
    const res = await PATCH(makePatch('target-1', { scopes: 'orders' }), {
      params: Promise.resolve({ id: 'target-1' }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid scopes')
  })

  it('returns 400 for invalid role', async () => {
    const res = await PATCH(makePatch('target-1', { role: 'super_admin' }), {
      params: Promise.resolve({ id: 'target-1' }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid role')
  })

  it('returns 404 when admin not found after update', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await PATCH(makePatch('target-1', { scopes: ['orders'] }), {
      params: Promise.resolve({ id: 'target-1' }),
    })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Admin not found')
  })

  it('updates scopes successfully', async () => {
    mockQueryOne.mockResolvedValueOnce(updatedAdmin as any)
    const res = await PATCH(makePatch('target-1', { scopes: ['orders', 'products'] }), {
      params: Promise.resolve({ id: 'target-1' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.admin).toEqual(updatedAdmin)
  })

  it('updates role to admin', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...updatedAdmin, role: 'admin' } as any)
    const res = await PATCH(makePatch('target-1', { role: 'admin' }), { params: Promise.resolve({ id: 'target-1' }) })
    expect(res.status).toBe(200)
  })

  it('updates role to moderator', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...updatedAdmin, role: 'moderator' } as any)
    const res = await PATCH(makePatch('target-1', { role: 'moderator' }), {
      params: Promise.resolve({ id: 'target-1' }),
    })
    expect(res.status).toBe(200)
  })

  it('updates is_active and revokes certificates when set to false', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...updatedAdmin, is_active: false } as any)
    const res = await PATCH(makePatch('target-1', { is_active: false }), {
      params: Promise.resolve({ id: 'target-1' }),
    })
    expect(res.status).toBe(200)
    // Check certificate revocation query was called
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('is_revoked = true'), ['target-1'])
  })

  it('does not revoke certificates when is_active set to true', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...updatedAdmin, is_active: true } as any)
    const res = await PATCH(makePatch('target-1', { is_active: true }), { params: Promise.resolve({ id: 'target-1' }) })
    expect(res.status).toBe(200)
    // Certificate revoke query should NOT have been called
    const revokeCalls = mockQuery.mock.calls.filter(c => String(c[0]).includes('is_revoked = true'))
    expect(revokeCalls).toHaveLength(0)
  })

  // MFA reset
  describe('reset_mfa', () => {
    it('returns 400 when trying to reset own MFA', async () => {
      const res = await PATCH(makePatch('super-1', { reset_mfa: true }), { params: Promise.resolve({ id: 'super-1' }) })
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('Cannot reset your own MFA')
    })

    it('returns 404 when target admin not found for MFA reset', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      const res = await PATCH(makePatch('target-1', { reset_mfa: true }), {
        params: Promise.resolve({ id: 'target-1' }),
      })
      expect(res.status).toBe(404)
      expect((await res.json()).error).toBe('Admin not found')
    })

    it('resets MFA successfully', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'target-1' } as any) // target exists
      const res = await PATCH(makePatch('target-1', { reset_mfa: true }), {
        params: Promise.resolve({ id: 'target-1' }),
      })
      expect(res.status).toBe(200)
      expect((await res.json()).success).toBe(true)
      // MFA nullification query
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('mfa_secret_enc = NULL'), ['target-1'])
      // Recovery codes deletion
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM admin_mfa_recovery_codes'), [
        'target-1',
      ])
    })
  })

  it('returns 500 on unexpected error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('DB error'))
    const res = await PATCH(makePatch('target-1', { scopes: ['orders'] }), {
      params: Promise.resolve({ id: 'target-1' }),
    })
    expect(res.status).toBe(500)
  })
})

// ── DELETE ────────────────────────────────────────────────────────────────────

describe('DELETE /api/admin/users/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(SUPER_ADMIN as any)
    mockQuery.mockResolvedValue({ rows: [] } as any)
  })

  it('returns 403 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null as any)
    const res = await DELETE(makeDelete('target-1'), { params: Promise.resolve({ id: 'target-1' }) })
    expect(res.status).toBe(403)
  })

  it('returns 403 when not super_admin', async () => {
    mockAuth.mockResolvedValue(REGULAR_ADMIN as any)
    const res = await DELETE(makeDelete('target-1'), { params: Promise.resolve({ id: 'target-1' }) })
    expect(res.status).toBe(403)
  })

  it('returns 400 when deleting own account', async () => {
    const res = await DELETE(makeDelete('super-1'), { params: Promise.resolve({ id: 'super-1' }) })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Cannot delete your own account')
  })

  it('returns 404 when admin not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await DELETE(makeDelete('target-1'), { params: Promise.resolve({ id: 'target-1' }) })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Admin not found')
  })

  it('deletes admin without associated user', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'target-1', username: 'targetadmin', user_id: null } as any)
    const res = await DELETE(makeDelete('target-1'), { params: Promise.resolve({ id: 'target-1' }) })
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    // Should not delete user
    const userDeleteCalls = mockQuery.mock.calls.filter(c => String(c[0]).includes('DELETE FROM users'))
    expect(userDeleteCalls).toHaveLength(0)
  })

  it('deletes admin and associated user when user_id present', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'target-1', username: 'targetadmin', user_id: 'user-99' } as any)
    const res = await DELETE(makeDelete('target-1'), { params: Promise.resolve({ id: 'target-1' }) })
    expect(res.status).toBe(200)
    // Check certificates deleted
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM admin_certificates'), ['target-1'])
    // Check user deleted
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM users'), ['user-99'])
  })

  it('returns 500 on unexpected error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB crash'))
    const res = await DELETE(makeDelete('target-1'), { params: Promise.resolve({ id: 'target-1' }) })
    expect(res.status).toBe(500)
  })
})
