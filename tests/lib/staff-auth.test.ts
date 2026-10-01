import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mockResolveTenantId = vi.fn()
const mockResolveAdminByEmail = vi.fn()
const mockHasPlanScope = vi.fn()
const mockStaffSessionFromRequest = vi.fn()

vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: (...a: unknown[]) => mockResolveTenantId(...a) }))
vi.mock('@/lib/auth/admin-identity', () => ({ resolveAdminByEmail: (...a: unknown[]) => mockResolveAdminByEmail(...a) }))
vi.mock('@/lib/auth/plan-gate', () => ({ hasPlanScope: (...a: unknown[]) => mockHasPlanScope(...a) }))
vi.mock('@/lib/auth/staff-session', () => ({
  staffSessionFromRequest: (...a: unknown[]) => mockStaffSessionFromRequest(...a),
}))

import { requireStaff, isStaffDenied } from '@/lib/auth/staff-auth'

const claims = { adminId: 'admin-1', tenantId: null, email: 'owner@example.com', name: 'Owner' }
const req = () => new NextRequest('https://jeffistores.in/api/staff/notes')

describe('requireStaff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveTenantId.mockResolvedValue(null)
    mockStaffSessionFromRequest.mockResolvedValue(claims)
    mockResolveAdminByEmail.mockResolvedValue({ id: 'admin-1', role: 'administrator', scopes: ['customers:write'] })
    mockHasPlanScope.mockResolvedValue(true)
  })

  it('401 without a valid cookie', async () => {
    mockStaffSessionFromRequest.mockResolvedValue(null)
    const r = await requireStaff(req(), 'customers:read')
    expect(isStaffDenied(r) && r.status).toBe(401)
    expect(mockResolveAdminByEmail).not.toHaveBeenCalled()
  })

  it('reads role and scopes from the admin record, not the cookie', async () => {
    const r = await requireStaff(req(), 'customers:write')
    expect(isStaffDenied(r)).toBe(false)
    expect(r).toMatchObject({
      session: { ...claims, role: 'administrator', scopes: ['customers:write'] },
      tenantId: null,
    })
    expect(mockHasPlanScope).toHaveBeenCalledWith('administrator', ['customers:write'], 'customers:write')
  })

  it('401 when the admin was deactivated after signing in', async () => {
    mockResolveAdminByEmail.mockResolvedValue(null)
    const r = await requireStaff(req(), 'customers:read')
    expect(isStaffDenied(r) && r.status).toBe(401)
  })

  it('401 when the email now belongs to a different admin id', async () => {
    mockResolveAdminByEmail.mockResolvedValue({ id: 'someone-else', role: 'administrator', scopes: [] })
    const r = await requireStaff(req(), 'customers:read')
    expect(isStaffDenied(r) && r.status).toBe(401)
  })

  it('403 when the role or plan does not grant the scope', async () => {
    mockHasPlanScope.mockResolvedValue(false)
    const r = await requireStaff(req(), 'customers:write')
    expect(isStaffDenied(r) && r.status).toBe(403)
  })

  it('isStaffDenied tells a response from a session', () => {
    expect(isStaffDenied(NextResponse.json({}, { status: 401 }))).toBe(true)
    expect(isStaffDenied({ session: claims, tenantId: null })).toBe(false)
  })
})
