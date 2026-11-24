import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const auth = vi.hoisted(() => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => auth)
const reg = vi.hoisted(() => ({ getKyc: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => reg)
const upload = vi.hoisted(() => ({ getKycDocumentStream: vi.fn() }))
vi.mock('@controller/lib/catalog/kyc-upload', () => upload)

import { GET } from '@controller/app/api/(admin)/admin/ecom/kyc/[tenantId]/cert/route'

const call = () => GET(new NextRequest('http://localhost/api/admin/ecom/kyc/t-1/cert'), { params: Promise.resolve({ tenantId: 't-1' }) })

beforeEach(() => {
  vi.clearAllMocks()
  auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-1', role: 'administrator', scopes: [] })
  reg.getKyc.mockResolvedValue({ gst_cert_s3_key: 'kyc/t-1/gst.pdf' })
  upload.getKycDocumentStream.mockResolvedValue({ body: 'PDFBYTES', contentType: 'application/pdf' })
})

describe('GET /api/admin/ecom/kyc/[tenantId]/cert', () => {
  it('401s and 403s', async () => {
    auth.authenticateAdmin.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
    auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-2', role: 'super_admin', scopes: [] })
    expect((await call()).status).toBe(403)
    expect(reg.getKyc).not.toHaveBeenCalled()
  })

  it('404s when no certificate is on file', async () => {
    reg.getKyc.mockResolvedValue({ gst_cert_s3_key: null })
    expect((await call()).status).toBe(404)
    reg.getKyc.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
    expect(upload.getKycDocumentStream).not.toHaveBeenCalled()
  })

  it('streams the certificate inline', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toBe('inline; filename="gst-cert-t-1"')
    expect(await res.text()).toBe('PDFBYTES')
    expect(upload.getKycDocumentStream).toHaveBeenCalledWith('kyc/t-1/gst.pdf')
  })
})
