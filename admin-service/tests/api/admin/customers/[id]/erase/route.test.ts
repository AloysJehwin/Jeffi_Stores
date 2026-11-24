import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/shared/admin-audit', () => ({ logAdminAudit: vi.fn() }))
vi.mock('@/lib/account/delete-account', () => ({ checkAccountDeletion: vi.fn(), deleteCustomerAccount: vi.fn() }))

import { GET, POST } from '@admin/app/api/(admin)/admin/customers/[id]/erase/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { checkAccountDeletion, deleteCustomerAccount } from '@/lib/account/delete-account'

const ctx = { params: Promise.resolve({ id: 'u1' }) }
const get = () => new NextRequest('http://localhost/api/admin/customers/u1/erase')
const post = (body: unknown) => new NextRequest('http://localhost/api/admin/customers/u1/erase', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })

describe('customers/[id]/erase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: [] } as any)
  })

  it('relays a scope rejection on both methods', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 403 }))
    expect((await GET(get(), ctx)).status).toBe(403)
    expect((await POST(post({ confirm: 'DELETE' }), ctx)).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'customers:write')
    expect(deleteCustomerAccount).not.toHaveBeenCalled()
  })

  it('GET returns the deletion check', async () => {
    vi.mocked(checkAccountDeletion).mockResolvedValue({ canDelete: true, blockers: [] } as any)
    expect(await (await GET(get(), ctx)).json()).toEqual({ canDelete: true, blockers: [] })
    expect(checkAccountDeletion).toHaveBeenCalledWith('u1')
  })

  it('POST 400s unless DELETE is typed', async () => {
    expect((await POST(post({ confirm: 'delete' }), ctx)).status).toBe(400)
    expect((await POST(post('nope'), ctx)).status).toBe(400)
    expect(deleteCustomerAccount).not.toHaveBeenCalled()
  })

  it('POST erases the account and audits it', async () => {
    vi.mocked(deleteCustomerAccount).mockResolvedValue({ ok: true, alreadyDeleted: false, summary: { orders: 1 } } as any)
    const res = await POST(post({ confirm: 'DELETE', reason: '  GDPR ' }), ctx)
    expect(await res.json()).toEqual({ deleted: true })
    expect(deleteCustomerAccount).toHaveBeenCalledWith('u1', { via: 'admin', adminId: 'a1', reason: 'GDPR' })
    expect(logAdminAudit).toHaveBeenCalledWith(expect.objectContaining({ adminId: 'a1', action: 'delete', entityType: 'customer', entityId: 'u1', metadata: { reason: 'GDPR', summary: { orders: 1 } } }))
  })

  it('POST defaults the reason and skips the audit when already deleted', async () => {
    vi.mocked(deleteCustomerAccount).mockResolvedValue({ ok: true, alreadyDeleted: true } as any)
    await POST(post({ confirm: 'DELETE' }), ctx)
    expect(deleteCustomerAccount).toHaveBeenCalledWith('u1', expect.objectContaining({ reason: 'Customer request' }))
    expect(logAdminAudit).not.toHaveBeenCalled()
  })

  it('POST 409s with blockers', async () => {
    vi.mocked(deleteCustomerAccount).mockResolvedValue({ ok: false, blockers: [{ message: 'Open orders' }] } as any)
    const res = await POST(post({ confirm: 'DELETE' }), ctx)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Open orders', blockers: [{ message: 'Open orders' }] })
    expect(logAdminAudit).not.toHaveBeenCalled()
  })

  it('POST relays a typed failure status', async () => {
    vi.mocked(deleteCustomerAccount).mockResolvedValue({ ok: false, error: 'Not found', status: 404 } as any)
    const res = await POST(post({ confirm: 'DELETE' }), ctx)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not found' })
  })
})
