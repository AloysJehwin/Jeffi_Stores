import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockOwner, mockGetDraft, mockCheck, mockAllow, mockExpected, mockProblem } = vi.hoisted(() => ({
  mockOwner: vi.fn(),
  mockGetDraft: vi.fn(),
  mockCheck: vi.fn(),
  mockAllow: vi.fn(),
  mockExpected: vi.fn(),
  mockProblem: vi.fn(),
}))

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'sid' }) }) }))
vi.mock('@/lib/auth/owner-session', () => ({ OWNER_COOKIE: 'owner_sid', resolveOwnerSession: mockOwner }))
vi.mock('@/lib/auth/session-signals-request', () => ({ extractSessionSignals: () => ({}) }))
vi.mock('@/lib/tenant-registry', () => ({ getDraft: mockGetDraft }))
vi.mock('@controller/lib/catalog/kyc-upload', () => ({ kycKeyPrefix: (id: string) => `kyc/${id}/` }))
vi.mock('@controller/lib/catalog/compliance', () => ({ isIsoDate: (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) }))
vi.mock('@controller/lib/kyb/requirements', () => ({ docNumberProblem: mockProblem }))
vi.mock('@controller/lib/kyb/analyze', () => ({ checkUpload: mockCheck }))
vi.mock('@controller/lib/kyb/throttle', () => ({ allow: mockAllow }))
vi.mock('@controller/app/(ecom)/ecom/onboard/kyb', () => ({ isKybDoc: (d: string) => ['pan_card', 'gst_cert', 'udyam'].includes(d), kybExpected: mockExpected }))

import { POST } from '@controller/app/api/(ecom)/ecom/onboard/kyb-check/route'

const req = (body: unknown) =>
  new NextRequest('https://ecom.jeffistores.in/api/ecom/onboard/kyb-check', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const GOOD = { s3Key: 'kyc/o-1/pan_card/a.pdf', docType: 'pan_card' }

describe('POST /api/ecom/onboard/kyb-check', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOwner.mockResolvedValue({ id: 'o-1' })
    mockAllow.mockReturnValue(true)
    mockProblem.mockReturnValue(null)
    mockGetDraft.mockResolvedValue({ data: { pan: 'ABCDE1234F' } })
    mockExpected.mockReturnValue({ pan: 'ABCDE1234F' })
    mockCheck.mockResolvedValue({ matches: true })
  })

  it('401s without a session', async () => {
    mockOwner.mockResolvedValue(null)
    expect((await POST(req(GOOD))).status).toBe(401)
  })

  it('rejects bad input: body, doc type, foreign key, expiry, number', async () => {
    expect((await POST(req({ docType: 'pan_card' }))).status).toBe(400)
    expect((await POST(req({ ...GOOD, docType: 'selfie' }))).status).toBe(400)
    expect((await POST(req({ ...GOOD, s3Key: 'kyc/o-2/pan_card/a.pdf' }))).status).toBe(403)
    expect((await POST(req({ ...GOOD, expiresOn: '31/12/2030' }))).status).toBe(400)
    mockProblem.mockReturnValue('Check the number.')
    const res = await POST(req({ s3Key: 'kyc/o-1/udyam/a.pdf', docType: 'udyam', number: 'x' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Check the number.')
    expect(mockCheck).not.toHaveBeenCalled()
  })

  it('429s when the owner has used the check allowance', async () => {
    mockAllow.mockReturnValue(false)
    expect((await POST(req(GOOD))).status).toBe(429)
    expect(mockAllow).toHaveBeenCalledWith('kyb-check:o-1', 12, 600000)
    expect(mockCheck).not.toHaveBeenCalled()
  })

  it('compares the upload with the draft answers and returns the analysis', async () => {
    const res = await POST(req(GOOD))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ analysis: { matches: true } })
    expect(mockExpected).toHaveBeenCalledWith('pan_card', { pan: 'ABCDE1234F' }, { number: undefined, expiresOn: undefined })
    expect(mockCheck).toHaveBeenCalledWith(GOOD.s3Key, 'pan_card', { pan: 'ABCDE1234F' })
  })

  it('reports unreadable when the analysis comes back empty', async () => {
    mockCheck.mockResolvedValue(null)
    expect(await (await POST(req(GOOD))).json()).toEqual({ analysis: null, reason: 'unreadable' })
  })
})
