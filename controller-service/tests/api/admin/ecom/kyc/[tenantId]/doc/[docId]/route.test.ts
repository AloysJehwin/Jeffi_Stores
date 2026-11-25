import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const auth = vi.hoisted(() => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => auth)
const upload = vi.hoisted(() => ({ getKycDocumentStream: vi.fn() }))
vi.mock('@controller/lib/catalog/kyc-upload', () => upload)
const docs = vi.hoisted(() => ({ getComplianceDocument: vi.fn() }))
vi.mock('@controller/lib/catalog/compliance-docs', () => docs)

import { GET } from '@controller/app/api/(admin)/admin/ecom/kyc/[tenantId]/doc/[docId]/route'

const call = () => GET(new NextRequest('http://localhost/api/admin/ecom/kyc/t-1/doc/d-1'), { params: Promise.resolve({ tenantId: 't-1', docId: 'd-1' }) })

beforeEach(() => {
  vi.clearAllMocks()
  auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-1', role: 'administrator', scopes: [] })
  docs.getComplianceDocument.mockResolvedValue({ s3_key: 'kyc/t-1/lic.png', doc_type: 'fssai' })
  upload.getKycDocumentStream.mockResolvedValue({ body: 'IMG', contentType: 'image/png' })
})

describe('GET /api/admin/ecom/kyc/[tenantId]/doc/[docId]', () => {
  it('401s and 403s', async () => {
    auth.authenticateAdmin.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
    auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-2', role: 'super_admin', scopes: [] })
    expect((await call()).status).toBe(403)
    expect(docs.getComplianceDocument).not.toHaveBeenCalled()
  })

  it('404s for an unknown document', async () => {
    docs.getComplianceDocument.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
    expect(upload.getKycDocumentStream).not.toHaveBeenCalled()
  })

  it('streams the document inline with nosniff', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    expect(res.headers.get('Content-Disposition')).toBe('inline; filename="fssai-t-1"')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(docs.getComplianceDocument).toHaveBeenCalledWith('t-1', 'd-1')
    expect(upload.getKycDocumentStream).toHaveBeenCalledWith('kyc/t-1/lic.png')
  })
})
