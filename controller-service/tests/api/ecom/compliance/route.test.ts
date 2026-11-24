import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockOwner, mockTenants, mockList, mockSubmit, mockAlert, mockProblem } = vi.hoisted(() => ({
  mockOwner: vi.fn(),
  mockTenants: vi.fn(),
  mockList: vi.fn(),
  mockSubmit: vi.fn(),
  mockAlert: vi.fn(),
  mockProblem: vi.fn(),
}))

const TID = '11111111-1111-4111-8111-111111111111'

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'sid' }) }) }))
vi.mock('@/lib/auth/owner-session', () => ({ OWNER_COOKIE: 'owner_sid', resolveOwnerSession: mockOwner }))
vi.mock('@/lib/auth/session-signals-request', () => ({ extractSessionSignals: () => ({}) }))
vi.mock('@/lib/tenant-registry', () => ({
  getOwnerTenants: mockTenants,
  hasService: (t: { service_types: string[] }, s: string) => t.service_types.includes(s),
}))
vi.mock('@controller/lib/catalog/compliance', () => ({
  DOCS: { fssai: { name: 'FSSAI licence', numberLabel: 'Licence no.', expires: true } },
  GENERAL: 'general',
  SELLING_CATEGORIES: ['food'],
  categoryDocs: (c: string) => (c === 'food' ? [{ doc: 'fssai' }] : []),
  cleanDocNumber: (n: string) => n.trim(),
  docProblem: mockProblem,
  todayIst: () => '2026-11-24',
}))
vi.mock('@controller/lib/catalog/compliance-docs', () => ({ listComplianceDocuments: mockList, submitComplianceDocument: mockSubmit }))
vi.mock('@controller/lib/catalog/compliance-notify', () => ({ alertDocumentSubmitted: mockAlert }))
vi.mock('@controller/lib/catalog/kyc-upload', () => ({ kycKeyPrefix: (o: string, d: string) => `kyc/${o}/${d}/` }))

import { PUT } from '@controller/app/api/(ecom)/ecom/compliance/route'

const GOOD = { tenantId: TID, docType: 'fssai', category: 'food', number: '123456', expiresOn: '2027-01-01', s3Key: 'kyc/o-1/fssai/a.pdf', fileName: 'a.pdf' }
const req = (body: unknown) =>
  new NextRequest('https://ecom.jeffistores.in/api/ecom/compliance', { method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

describe('PUT /api/ecom/compliance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOwner.mockResolvedValue({ id: 'o-1' })
    mockTenants.mockResolvedValue([{ id: TID, status: 'active', service_types: ['store'] }])
    mockList.mockResolvedValue([])
    mockProblem.mockReturnValue(null)
    mockSubmit.mockResolvedValue({ id: 'd-1', status: 'pending' })
    mockAlert.mockResolvedValue(undefined)
  })

  it('401s a signed-out caller', async () => {
    mockOwner.mockResolvedValue(null)
    expect((await PUT(req(GOOD))).status).toBe(401)
    expect(mockSubmit).not.toHaveBeenCalled()
  })

  it('400s a bad body, 404s a foreign store and 400s a non-store tenant', async () => {
    expect((await PUT(req({ tenantId: 'x' }))).status).toBe(400)
    mockTenants.mockResolvedValue([])
    expect((await PUT(req(GOOD))).status).toBe(404)
    mockTenants.mockResolvedValue([{ id: TID, status: 'active', service_types: ['messaging'] }])
    expect((await PUT(req(GOOD))).status).toBe(400)
  })

  it('400s an unknown doc type, a category that does not ask for it and a foreign upload key', async () => {
    expect((await PUT(req({ ...GOOD, docType: 'bogus' }))).status).toBe(400)
    expect((await PUT(req({ ...GOOD, category: 'general' }))).status).toBe(400)
    expect((await PUT(req({ ...GOOD, s3Key: 'kyc/other/fssai/a.pdf' }))).status).toBe(400)
    expect(mockSubmit).not.toHaveBeenCalled()
  })

  it('400s with the document problem text', async () => {
    mockProblem.mockReturnValue('Licence has expired')
    const res = await PUT(req(GOOD))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Licence has expired')
  })

  it('files the document and alerts the reviewer', async () => {
    const res = await PUT(req(GOOD))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, document: { id: 'd-1', status: 'pending' } })
    expect(mockSubmit).toHaveBeenCalledWith(TID, 'o-1', { docType: 'fssai', category: 'food', number: '123456', expiresOn: '2027-01-01', s3Key: GOOD.s3Key, fileName: 'a.pdf' })
    expect(mockAlert).toHaveBeenCalledWith(expect.objectContaining({ id: TID }), { id: 'd-1', status: 'pending' }, false)
  })

  it('a replacement keeps its category and does not fail when the alert does', async () => {
    mockList.mockResolvedValue([{ doc_type: 'fssai', category: 'food' }])
    mockAlert.mockRejectedValue(new Error('smtp'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await PUT(req({ ...GOOD, category: 'general' }))
    expect(res.status).toBe(200)
    expect(mockSubmit.mock.calls[0][2].category).toBe('food')
    expect(mockAlert.mock.calls[0][2]).toBe(true)
  })
})
