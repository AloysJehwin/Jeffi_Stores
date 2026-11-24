import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const { mockOwnerApi, mockUpload, mockUpsert, mockGetKyb, mockSetGst, mockAnalyze, mockView, mockAllow } = vi.hoisted(() => ({
  mockOwnerApi: vi.fn(),
  mockUpload: vi.fn(),
  mockUpsert: vi.fn(),
  mockGetKyb: vi.fn(),
  mockSetGst: vi.fn(),
  mockAnalyze: vi.fn(),
  mockView: vi.fn(),
  mockAllow: vi.fn(),
}))

vi.mock('@controller/lib/ecom/owner-api', () => ({ ownerApi: mockOwnerApi }))
vi.mock('@controller/lib/catalog/kyc-upload', () => ({ uploadKycDocument: mockUpload }))
vi.mock('@controller/lib/catalog/compliance', () => ({ isIsoDate: (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s), todayIst: () => '2026-11-24' }))
vi.mock('@controller/lib/kyb/requirements', () => ({
  KYB_DOCS: { pan_card: {}, gst_cert: {}, shop_licence: {} },
  docNumberProblem: (_t: string, n: string) => (n === 'bad' ? 'Number looks wrong' : null),
  formatDocNumber: (_t: string, n: string) => n.toUpperCase(),
}))
vi.mock('@controller/lib/kyb/store', () => ({ getKybRecord: mockGetKyb, setGstCertKey: mockSetGst, upsertKybDocument: mockUpsert }))
vi.mock('@controller/lib/kyb/analyze', () => ({ analyzeDocument: mockAnalyze }))
vi.mock('@controller/lib/kyb/view', () => ({ loadKybView: mockView }))
vi.mock('@controller/lib/kyb/throttle', () => ({ allow: mockAllow }))

import { POST } from '@controller/app/api/(ecom)/ecom/kyb/documents/route'

const TENANT = { id: 't-1' }
function req(fields: Record<string, string>, file: File | null = new File(['%PDF'], 'pan.pdf', { type: 'application/pdf' })) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  if (file) fd.set('file', file)
  return new NextRequest('https://ecom.jeffistores.in/api/ecom/kyb/documents', { method: 'POST', body: fd })
}

describe('POST /api/ecom/kyb/documents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOwnerApi.mockResolvedValue({ owner: { id: 'o-1' }, tenant: TENANT, tenants: [TENANT] })
    mockGetKyb.mockResolvedValue({ pan: 'ABCDE1234F', gst_number: '22AAAAA0000A1Z5' })
    mockAllow.mockReturnValue(true)
    mockUpload.mockResolvedValue('kyc/o-1/pan_card/x.pdf')
    mockUpsert.mockResolvedValue({ id: 'doc-1' })
    mockAnalyze.mockResolvedValue(undefined)
    mockView.mockResolvedValue({ status: 'in_review' })
  })

  it('returns the guard response when not signed in', async () => {
    mockOwnerApi.mockResolvedValue(NextResponse.json({ error: 'Not signed in' }, { status: 401 }))
    expect((await POST(req({ docType: 'pan_card' }))).status).toBe(401)
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('400s an unknown type, a missing file, a wrong file type and an oversize file', async () => {
    expect((await POST(req({ docType: 'bogus' }))).status).toBe(400)
    expect((await POST(req({ docType: 'pan_card' }, null))).status).toBe(400)
    expect((await POST(req({ docType: 'pan_card' }, new File(['x'], 'a.exe', { type: 'application/x-msdownload' })))).status).toBe(400)
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.pdf', { type: 'application/pdf' })
    expect((await POST(req({ docType: 'pan_card' }, big))).status).toBe(400)
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('400s a bad registration number and a past expiry', async () => {
    const res = await POST(req({ docType: 'shop_licence', number: 'bad' }))
    expect(res.status).toBe(400)
    expect((await res.json()).fields.number).toBe('Number looks wrong')
    expect((await POST(req({ docType: 'shop_licence', number: 'ok', expiresOn: '2020-01-01' }))).status).toBe(400)
  })

  it('429s when throttled', async () => {
    mockAllow.mockReturnValue(false)
    expect((await POST(req({ docType: 'pan_card' }))).status).toBe(429)
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('stores a PAN card against the PAN on file, analyses it and returns the view', async () => {
    const res = await POST(req({ docType: 'pan_card' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ kyb: { status: 'in_review' } })
    expect(mockUpload).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 'o-1', docType: 'pan_card', mimeType: 'application/pdf' }))
    expect(mockUpsert).toHaveBeenCalledWith('t-1', 'o-1', { docType: 'pan_card', number: 'ABCDE1234F', expiresOn: null, s3Key: 'kyc/o-1/pan_card/x.pdf', fileName: 'pan.pdf' })
    expect(mockAnalyze).toHaveBeenCalledWith({ id: 'doc-1' }, expect.objectContaining({ pan: 'ABCDE1234F' }))
    expect(mockSetGst).not.toHaveBeenCalled()
  })

  it('records the GST certificate key', async () => {
    await POST(req({ docType: 'gst_cert' }))
    expect(mockSetGst).toHaveBeenCalledWith('t-1', 'kyc/o-1/pan_card/x.pdf')
  })

  it('propagates a storage failure', async () => {
    mockUpload.mockRejectedValue(new Error('s3 down'))
    await expect(POST(req({ docType: 'pan_card' }))).rejects.toThrow('s3 down')
    expect(mockUpsert).not.toHaveBeenCalled()
  })
})
