import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const auth = vi.hoisted(() => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => auth)
const query = vi.hoisted(() => vi.fn())
const reg = vi.hoisted(() => ({
  rejectKyc: vi.fn(),
  getKyc: vi.fn(),
  getOwnerById: vi.fn(),
  getTenant: vi.fn(),
  hasService: vi.fn(),
  reviewServiceApproval: vi.fn(),
}))
vi.mock('@/lib/tenant-registry', () => ({ ...reg, controlPlanePool: () => ({ query }) }))
const mail = vi.hoisted(() => ({ sendKycRejectedEmail: vi.fn(), sendServicesReviewedEmail: vi.fn() }))
vi.mock('@/lib/shared/ecom-emails', () => mail)

import { POST } from '@controller/app/api/(admin)/admin/ecom/kyc/[tenantId]/reject/route'

const call = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/admin/ecom/kyc/t-1/reject', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }), {
    params: Promise.resolve({ tenantId: 't-1' }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-1', email: 'op@example.com', role: 'administrator', scopes: [] })
  reg.getTenant.mockResolvedValue({ id: 't-1', display_name: 'Acme' })
  reg.hasService.mockReturnValue(true)
  reg.getKyc.mockResolvedValue({ owner_id: 'o-1' })
  reg.getOwnerById.mockResolvedValue({ email: 'owner@example.com', name: 'Olive' })
  reg.reviewServiceApproval.mockResolvedValue(['messaging'])
  mail.sendKycRejectedEmail.mockResolvedValue(undefined)
  mail.sendServicesReviewedEmail.mockResolvedValue(undefined)
  query.mockResolvedValue({ rows: [] })
})

describe('POST /api/admin/ecom/kyc/[tenantId]/reject', () => {
  it('401s and 403s', async () => {
    auth.authenticateAdmin.mockResolvedValue(null)
    expect((await call({ note: 'x' })).status).toBe(401)
    auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-2', role: 'super_admin', scopes: [] })
    expect((await call({ note: 'x' })).status).toBe(403)
    expect(reg.rejectKyc).not.toHaveBeenCalled()
  })

  it.each([[{}], [{ note: '' }], ['not json']])('400s without a note %#', async body => {
    expect((await call(body)).status).toBe(400)
    expect(reg.rejectKyc).not.toHaveBeenCalled()
  })

  it('rejects a store application and mails the owner', async () => {
    const res = await call({ note: 'GST mismatch' })
    expect(await res.json()).toEqual({ ok: true })
    expect(reg.rejectKyc).toHaveBeenCalledWith('t-1', 'op@example.com', 'GST mismatch')
    expect(mail.sendKycRejectedEmail).toHaveBeenCalledWith({ email: 'owner@example.com', name: 'Olive' }, 'GST mismatch')
  })

  it('still rejects when there is no KYC row to mail from, or the mail fails', async () => {
    reg.getKyc.mockResolvedValue(null)
    expect((await call({ note: 'x' })).status).toBe(200)
    expect(mail.sendKycRejectedEmail).not.toHaveBeenCalled()
    reg.getKyc.mockResolvedValue({ owner_id: 'o-1' })
    mail.sendKycRejectedEmail.mockRejectedValue(new Error('smtp'))
    expect((await call({ note: 'x' })).status).toBe(200)
  })

  it('for an API-only workspace rejects KYC and pending services, keeping the workspace', async () => {
    reg.hasService.mockReturnValue(false)
    const res = await call({ note: 'no docs' })
    expect(await res.json()).toEqual({ ok: true, services: ['messaging'] })
    expect(query.mock.calls[0][0]).toContain("status='rejected'")
    expect(query.mock.calls[0][1]).toEqual(['t-1', 'op@example.com', 'no docs'])
    expect(reg.reviewServiceApproval).toHaveBeenCalledWith('t-1', 'all-pending', 'rejected', 'op@example.com', 'no docs')
    expect(reg.rejectKyc).not.toHaveBeenCalled()
    expect(mail.sendServicesReviewedEmail).toHaveBeenCalledWith({ email: 'owner@example.com', name: 'Olive' }, 'Acme', ['messaging'], 'rejected', 'no docs')
  })

  it('sends no services mail when nothing was pending', async () => {
    reg.hasService.mockReturnValue(false)
    reg.reviewServiceApproval.mockResolvedValue([])
    await call({ note: 'no docs' })
    expect(mail.sendServicesReviewedEmail).not.toHaveBeenCalled()
  })
})
