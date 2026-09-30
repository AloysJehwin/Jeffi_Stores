import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))
vi.mock('@/lib/email', () => ({ sendQuotationFinalizedEmail: vi.fn() }))

import { POST } from '@/app/api/admin/quotations/[id]/resend-email/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'
import { sendQuotationFinalizedEmail } from '@/lib/email'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockSendEmail = vi.mocked(sendQuotationFinalizedEmail)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['quotations'] }
const params = Promise.resolve({ id: 'qt-123' })

function makeRequest() {
  return new NextRequest('http://localhost/api/admin/quotations/qt-123/resend-email', { method: 'POST' })
}

const sampleQuotation = {
  consignee_email: 'buyer@example.com',
  consignee_name: 'Buyer',
  quote_number: 'QT-001',
  total_amount: '5000',
  view_token: 'tok-abc',
}

describe('POST /api/admin/quotations/[id]/resend-email', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  it('returns 403 when scope is missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/insufficient/i)
  })

  it('returns 404 when quotation not found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/not found/i)
  })

  it('returns 400 when no email on file', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ ...sampleQuotation, consignee_email: null })

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/no email/i)
  })

  it('sends email and returns success', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(sampleQuotation)
    mockSendEmail.mockResolvedValue(undefined as any)

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(mockSendEmail).toHaveBeenCalledWith(
      'buyer@example.com',
      'Buyer',
      'QT-001',
      5000,
      'https://quotation.jeffistores.in/tok-abc'
    )
  })

  it('handles null consignee_name gracefully', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ ...sampleQuotation, consignee_name: null })
    mockSendEmail.mockResolvedValue(undefined as any)

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(200)
    expect(mockSendEmail).toHaveBeenCalledWith(
      'buyer@example.com',
      '',
      expect.any(String),
      expect.any(Number),
      expect.any(String)
    )
  })

  it('returns 500 on email send failure', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(sampleQuotation)
    mockSendEmail.mockRejectedValue(new Error('SMTP error'))

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('SMTP error')
  })
})
