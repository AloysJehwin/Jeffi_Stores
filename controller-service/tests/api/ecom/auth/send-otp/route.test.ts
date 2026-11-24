import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockRate, mockStore, mockRecord, mockSend, mockQuery } = vi.hoisted(() => ({
  mockRate: vi.fn(),
  mockStore: vi.fn(),
  mockRecord: vi.fn(),
  mockSend: vi.fn(),
  mockQuery: vi.fn(),
}))

vi.mock('@/lib/auth/otp', () => ({
  generateOTP: () => '123456',
  storeOTP: mockStore,
  checkSendOtpRateLimit: mockRate,
  recordSendOtp: mockRecord,
}))
vi.mock('@/lib/shared/ecom-emails', () => ({ sendOwnerOTPEmail: mockSend }))
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query: mockQuery }) }))

import { POST } from '@controller/app/api/(ecom)/ecom/auth/send-otp/route'

const req = (body: unknown) =>
  new NextRequest('https://ecom.jeffistores.in/api/ecom/auth/send-otp', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

describe('POST /api/ecom/auth/send-otp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRate.mockResolvedValue({ allowed: true, nextCooldown: 30 })
    mockSend.mockResolvedValue({ success: true })
    mockQuery.mockResolvedValue({ rows: [{ name: 'Saved Name' }] })
  })

  it('400s a missing or malformed email', async () => {
    expect((await POST(req({}))).status).toBe(400)
    expect((await POST(req({ email: 'nope' }))).status).toBe(400)
    expect(mockStore).not.toHaveBeenCalled()
  })

  it('429s with Retry-After while rate limited', async () => {
    mockRate.mockResolvedValue({ allowed: false, retryAfter: 42 })
    const res = await POST(req({ email: 'o@acme.test' }))
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('42')
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('stores the code, emails it with the typed name and records the send', async () => {
    const res = await POST(req({ email: 'O@Acme.test', name: 'Priya  Sharma' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ message: 'OTP sent', email: 'o@acme.test', nextCooldown: 30 })
    expect(mockStore).toHaveBeenCalledWith('O@Acme.test', '123456')
    expect(mockSend).toHaveBeenCalledWith('O@Acme.test', '123456', 'Priya Sharma')
    expect(mockRecord).toHaveBeenCalledWith('O@Acme.test')
  })

  it('falls back to the saved owner name when the typed one is not a name', async () => {
    await POST(req({ email: 'o@acme.test', name: 'http://x.co/1' }))
    expect(mockSend).toHaveBeenCalledWith('o@acme.test', '123456', 'Saved Name')
  })

  it('500s without counting the send when the email fails', async () => {
    mockSend.mockResolvedValue({ success: false })
    expect((await POST(req({ email: 'o@acme.test' }))).status).toBe(500)
    expect(mockRecord).not.toHaveBeenCalled()
  })
})
