import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  authenticateAdmin: vi.fn(),
  managerClient: vi.fn(),
  listManaged: vi.fn(),
  unlink: vi.fn(),
  audit: vi.fn(),
}))

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: m.authenticateAdmin }))
vi.mock('@/lib/shared/admin-audit', () => ({ logAdminAudit: m.audit }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(), queryMany: vi.fn(async () => []), query: vi.fn() }))
vi.mock('@/lib/google-ads/credentials', () => ({ managerClient: m.managerClient }))
vi.mock('@controller/lib/google-ads/manager-view', () => ({ listManagedAccounts: m.listManaged, unlinkManagedAccount: m.unlink }))

import { GET as managed } from '@controller/app/api/(admin)/admin/ecom/google-ads/route'
import { DELETE as unlink } from '@controller/app/api/(admin)/admin/ecom/google-ads/[customerId]/route'

const MGR = { customerId: '9998887776' }

beforeEach(() => {
  vi.clearAllMocks()
  m.managerClient.mockReturnValue(MGR)
})

describe('platform manager view', () => {
  it('is for platform admins only', async () => {
    m.authenticateAdmin.mockResolvedValue({ adminId: 'a1', role: 'super_admin' })
    const res = await managed(new NextRequest('https://acme.jeffistores.in/api/admin/ecom/google-ads'))
    expect(res.status).toBe(403)
    expect(m.listManaged).not.toHaveBeenCalled()
    const del = await unlink(new NextRequest('https://x/api/admin/ecom/google-ads/1112223334', { method: 'DELETE' }), { params: Promise.resolve({ customerId: '1112223334' }) })
    expect(del.status).toBe(403)
    expect(m.unlink).not.toHaveBeenCalled()
  })

  it('lists and unlinks for the platform operator', async () => {
    m.authenticateAdmin.mockResolvedValue({ adminId: 'p1', role: 'administrator' })
    m.listManaged.mockResolvedValue({ managerId: '9998887776', accounts: [] })
    expect((await managed(new NextRequest('https://admin.jeffistores.in/api/admin/ecom/google-ads'))).status).toBe(200)
    m.unlink.mockResolvedValue({ disconnected: [{ tenantId: 't1', name: 'Acme' }] })
    const del = await unlink(new NextRequest('https://x', { method: 'DELETE' }), { params: Promise.resolve({ customerId: '1112223334' }) })
    expect(await del.json()).toMatchObject({ ok: true, disconnected: [{ tenantId: 't1' }] })
    expect(m.unlink).toHaveBeenCalledWith(MGR, '1112223334')
  })
})
