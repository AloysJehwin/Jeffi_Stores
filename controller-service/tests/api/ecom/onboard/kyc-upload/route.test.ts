import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockOwner, mockUpload } = vi.hoisted(() => ({ mockOwner: vi.fn(), mockUpload: vi.fn() }))

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'sid' }) }) }))
vi.mock('@/lib/auth/owner-session', () => ({ OWNER_COOKIE: 'owner_sid', resolveOwnerSession: mockOwner }))
vi.mock('@/lib/auth/session-signals-request', () => ({ extractSessionSignals: () => ({}) }))
vi.mock('@controller/lib/catalog/kyc-upload', () => ({ uploadKycDocument: mockUpload }))
vi.mock('@controller/lib/catalog/compliance', () => ({ DOCS: { fssai: {} } }))
vi.mock('@controller/lib/kyb/requirements', () => ({ KYB_DOCS: { pan_card: {} } }))

import { POST } from '@controller/app/api/(ecom)/ecom/onboard/kyc-upload/route'

function req(file: File | null, docType?: string) {
  const fd = new FormData()
  if (file) fd.set('file', file)
  if (docType) fd.set('docType', docType)
  return new NextRequest('https://ecom.jeffistores.in/api/ecom/onboard/kyc-upload', { method: 'POST', body: fd })
}
const pdf = (size = 10) => new File([new Uint8Array(size)], 'doc.pdf', { type: 'application/pdf' })

describe('POST /api/ecom/onboard/kyc-upload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOwner.mockResolvedValue({ id: 'o-1' })
    mockUpload.mockResolvedValue('kyc/o-1/pan_card/doc.pdf')
  })

  it('401s without a session', async () => {
    mockOwner.mockResolvedValue(null)
    expect((await POST(req(pdf(), 'pan_card'))).status).toBe(401)
  })

  it('400s a missing file, an unknown docType, an oversize file and a wrong type', async () => {
    expect((await POST(req(null))).status).toBe(400)
    expect((await POST(req(pdf(), 'passport'))).status).toBe(400)
    expect((await POST(req(pdf(5 * 1024 * 1024 + 1), 'fssai'))).status).toBe(400)
    expect((await POST(req(new File(['x'], 'a.exe', { type: 'application/x-msdownload' })))).status).toBe(400)
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('stores a KYB document for the owner and returns the key', async () => {
    const res = await POST(req(pdf(), 'pan_card'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, s3Key: 'kyc/o-1/pan_card/doc.pdf' })
    expect(mockUpload).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'o-1', docType: 'pan_card', mimeType: 'application/pdf', originalFilename: 'doc.pdf' }),
    )
  })

  it('accepts an upload with no docType (older draft)', async () => {
    expect((await POST(req(pdf()))).status).toBe(200)
    expect(mockUpload.mock.calls[0][0].docType).toBeUndefined()
  })
})
