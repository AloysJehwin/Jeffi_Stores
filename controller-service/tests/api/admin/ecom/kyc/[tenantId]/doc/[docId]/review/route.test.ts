import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const auth = vi.hoisted(() => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => auth)
const reg = vi.hoisted(() => ({ getOwnerById: vi.fn(), getTenant: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => reg)
vi.mock('@controller/lib/catalog/compliance', () => ({ todayIst: () => '2026-06-15' }))
const docs = vi.hoisted(() => ({ getComplianceDocument: vi.fn(), reviewComplianceDocument: vi.fn() }))
vi.mock('@controller/lib/catalog/compliance-docs', () => docs)
const notify = vi.hoisted(() => ({ notifyDocumentRejected: vi.fn(), CONSOLE_STATUSES: ['active'] }))
vi.mock('@controller/lib/catalog/compliance-notify', () => notify)

import { POST } from '@controller/app/api/(admin)/admin/ecom/kyc/[tenantId]/doc/[docId]/review/route'

const call = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/admin/ecom/kyc/t-1/doc/d-1/review', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }), {
    params: Promise.resolve({ tenantId: 't-1', docId: 'd-1' }),
  })
const flush = () => new Promise(r => setTimeout(r, 0))

beforeEach(() => {
  vi.clearAllMocks()
  auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-1', email: 'op@example.com', role: 'administrator', scopes: [] })
  docs.getComplianceDocument.mockResolvedValue({ s3_key: 'k1', expires_on: '2027-01-01', doc_type: 'fssai' })
  docs.reviewComplianceDocument.mockResolvedValue({ owner_id: 'o-1', doc_type: 'fssai' })
  reg.getTenant.mockResolvedValue({ status: 'active', display_name: 'Acme', slug: 'acme' })
  reg.getOwnerById.mockResolvedValue({ email: 'owner@example.com', name: 'Olive' })
  notify.notifyDocumentRejected.mockResolvedValue(undefined)
})

describe('POST /api/admin/ecom/kyc/[tenantId]/doc/[docId]/review', () => {
  it('401s and 403s', async () => {
    auth.authenticateAdmin.mockResolvedValue(null)
    expect((await call({ decision: 'approved' })).status).toBe(401)
    auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-2', role: 'super_admin', scopes: [] })
    expect((await call({ decision: 'approved' })).status).toBe(403)
    expect(docs.reviewComplianceDocument).not.toHaveBeenCalled()
  })

  it.each([[{}], [{ decision: 'maybe' }], ['not json']])('400s for a bad body %#', async body => {
    expect((await call(body)).status).toBe(400)
  })

  it('404s for an unknown document', async () => {
    docs.getComplianceDocument.mockResolvedValue(null)
    expect((await call({ decision: 'approved' })).status).toBe(404)
  })

  it('409s when the owner sent a new copy since the admin looked', async () => {
    expect((await call({ decision: 'approved', version: 'old-key' })).status).toBe(409)
    expect(docs.reviewComplianceDocument).not.toHaveBeenCalled()
  })

  it('409s approving an expired document', async () => {
    docs.getComplianceDocument.mockResolvedValue({ s3_key: 'k1', expires_on: '2026-01-01' })
    const res = await call({ decision: 'approved' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('expired')
  })

  it('409s when the row changed underneath the review', async () => {
    docs.reviewComplianceDocument.mockResolvedValue(null)
    expect((await call({ decision: 'approved', version: 'k1' })).status).toBe(409)
  })

  it('approves without mailing anyone', async () => {
    const res = await call({ decision: 'approved', version: 'k1', note: ' fine ' })
    expect(res.status).toBe(200)
    expect(docs.reviewComplianceDocument).toHaveBeenCalledWith('t-1', 'd-1', 'approved', 'op@example.com', 'fine', 'k1', '2026-06-15')
    await flush()
    expect(notify.notifyDocumentRejected).not.toHaveBeenCalled()
  })

  it('rejects and mails the owner once the store has its console', async () => {
    const res = await call({ decision: 'rejected', note: 'blurry' })
    expect(res.status).toBe(200)
    await flush()
    expect(notify.notifyDocumentRejected).toHaveBeenCalledWith({ email: 'owner@example.com', name: 'Olive' }, 'Acme', { owner_id: 'o-1', doc_type: 'fssai' }, 'blurry')
  })

  it('does not mail during the application review', async () => {
    reg.getTenant.mockResolvedValue({ status: 'pending', display_name: 'Acme', slug: 'acme' })
    await call({ decision: 'rejected', note: 'blurry' })
    await flush()
    expect(notify.notifyDocumentRejected).not.toHaveBeenCalled()
  })

  it('still succeeds when the rejection mail fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    notify.notifyDocumentRejected.mockRejectedValue(new Error('smtp'))
    expect((await call({ decision: 'rejected', note: 'blurry' })).status).toBe(200)
    await flush()
  })
})
