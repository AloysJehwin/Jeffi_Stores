import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  queryOne: vi.fn(),
}))

vi.mock('@/lib/email', () => ({
  sendInvoiceFinalizedEmail: vi.fn(),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/invoices/[id]/resend-email/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne } from '@/lib/db'
import { sendInvoiceFinalizedEmail } from '@/lib/email'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockSendEmail = vi.mocked(sendInvoiceFinalizedEmail)

const adminPayload = {
  adminId: 'admin-1',
  username: 'testadmin',
  role: 'super_admin',
  scopes: ['invoices'],
}

function makeRequest(id = 'order-1') {
  return new NextRequest(`http://localhost/api/admin/invoices/${id}/resend-email`, {
    method: 'POST',
    headers: { cookie: 'admin_token=valid' },
  })
}

const sampleOrder = {
  customer_email: 'customer@example.com',
  customer_name: 'Jane Doe',
  invoice_number: 'INV-2024-001',
  total_amount: '1200.00',
  order_number: 'ORD-001',
  view_token: 'view-token-abc',
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/invoices/[id]/resend-email', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequest(), { params: { id: 'order-1' } })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope is insufficient', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeRequest(), { params: { id: 'order-1' } })
    expect(res.status).toBe(403)
  })

  it('returns 404 when order not found', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)
    const res = await POST(makeRequest('order-999'), { params: { id: 'order-999' } })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/not found/i)
  })

  it('returns 400 when no customer email', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ ...sampleOrder, customer_email: null })
    const res = await POST(makeRequest(), { params: { id: 'order-1' } })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/no email/i)
  })

  it('returns 400 when invoice not yet finalized', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ ...sampleOrder, invoice_number: null })
    const res = await POST(makeRequest(), { params: { id: 'order-1' } })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/not yet finalized/i)
  })

  it('sends invoice email and returns success', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(sampleOrder)
    mockSendEmail.mockResolvedValue(undefined as any)

    const res = await POST(makeRequest(), { params: { id: 'order-1' } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(mockSendEmail).toHaveBeenCalledWith(
      'customer@example.com',
      'Jane Doe',
      'INV-2024-001',
      1200,
      'ORD-001',
      expect.stringContaining('view-token-abc'),
    )
  })

  it('returns 500 on email send failure', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(sampleOrder)
    mockSendEmail.mockRejectedValue(new Error('email failed'))

    const res = await POST(makeRequest(), { params: { id: 'order-1' } })
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/email failed/i)
  })
})
