import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockOwner, mockFav, mockBankWithRoute, mockSave, mockSettle } = vi.hoisted(() => ({
  mockOwner: vi.fn(),
  mockFav: vi.fn(),
  mockBankWithRoute: vi.fn(),
  mockSave: vi.fn(),
  mockSettle: vi.fn(),
}))

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'sid' }) }) }))
vi.mock('@/lib/owner-session', () => ({ OWNER_COOKIE: 'owner_sid', resolveOwnerSession: mockOwner }))
vi.mock('@/lib/session-signals-request', () => ({ extractSessionSignals: () => ({}) }))
vi.mock('@/lib/bank-verify', () => ({ verifyBankAccountFAV: mockFav }))
vi.mock('@/lib/tenant-registry', () => ({
  getOwnerBankWithRoute: mockBankWithRoute,
  saveBankVerification: mockSave,
}))
vi.mock('@/lib/razorpay-route', () => ({ configureRouteSettlement: mockSettle }))

import { POST } from '@/app/api/ecom/bank/verify/route'

function req(body: Record<string, unknown>) {
  return new NextRequest('https://ecom.jeffistores.in/api/ecom/bank/verify', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: new Headers({ 'Content-Type': 'application/json' }),
  })
}

const GOOD = { accountNumber: '43014146741', ifsc: 'SBIN0071256', holderName: 'Aloys Jehwin' }

describe('correcting a bank account reaches the Route settlement config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOwner.mockResolvedValue({ id: 'o-1', email: 'o@acme.test' })
    mockFav.mockResolvedValue({ status: 'unverified', verifiedName: 'Aloys Jehwin' })
    mockSave.mockResolvedValue(undefined)
  })

  it('pushes the corrected account to the existing linked account', async () => {
    mockBankWithRoute.mockResolvedValue({ linkedAccountId: 'acc_1' })
    mockSettle.mockResolvedValue({ ok: true })
    const res = await POST(req(GOOD))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(mockSettle).toHaveBeenCalledWith('acc_1', {
      accountNumber: GOOD.accountNumber,
      ifsc: 'SBIN0071256',
      beneficiaryName: 'Aloys Jehwin',
    })
    expect(body.pushedToRoute).toBe(true)
    expect(body.status).toBe('verified')
  })

  it('reports the provider verdict, not the local format check', async () => {
    mockBankWithRoute.mockResolvedValue({ linkedAccountId: 'acc_1' })
    mockSettle.mockResolvedValue({ ok: false, error: 'Invalid IFSC Code' })
    const res = await POST(req(GOOD))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.status).toBe('failed')
    expect(body.reason).toBe('Invalid IFSC Code')
    expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', ref: 'route_rejected' }))
  })

  it('still saves when there is no linked account yet', async () => {
    mockBankWithRoute.mockResolvedValue({ linkedAccountId: null })
    const res = await POST(req(GOOD))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(mockSettle).not.toHaveBeenCalled()
    expect(body.pushedToRoute).toBe(false)
  })

  it('rejects a malformed account before touching Razorpay', async () => {
    mockFav.mockResolvedValue({ status: 'failed', reason: 'IFSC not recognised' })
    const res = await POST(req(GOOD))
    expect(res.status).toBe(400)
    expect(mockSettle).not.toHaveBeenCalled()
  })

  it('refuses an unauthenticated caller', async () => {
    mockOwner.mockResolvedValue(null)
    const res = await POST(req(GOOD))
    expect(res.status).toBe(401)
  })
})
