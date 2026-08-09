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
  sendPaymentRetryEmail: vi.fn(),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/orders/[id]/retry-email/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne } from '@/lib/db'
import { sendPaymentRetryEmail } from '@/lib/email'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockSendEmail = vi.mocked(sendPaymentRetryEmail)

const adminPayload = {
  adminId: 'admin-1',
  username: 'testadmin',
  role: 'super_admin',
  scopes: ['orders'],
}

function makeRequest(id = 'order-1') {
  return new NextRequest(`http://localhost/api/admin/orders/${id}/retry-email`, {
    method: 'POST',
    headers: { cookie: 'admin_sid=valid' },
  })
}

const recentFailedOrder = {
  id: 'order-1',
  order_number: 'ORD-001',
  customer_email: 'customer@example.com',
  customer_name: 'Jane Doe',
  payment_status: 'failed',
  total_amount: 1500,
  created_at: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/orders/[id]/retry-email', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'order-1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope is insufficient', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'order-1' }) })
    expect(res.status).toBe(403)
  })

  it('returns 404 when order not found', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)
    const res = await POST(makeRequest('order-999'), { params: Promise.resolve({ id: 'order-999' }) })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/not found/i)
  })

  it('returns 400 when payment status is not failed or unpaid', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ ...recentFailedOrder, payment_status: 'paid' })
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'order-1' }) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/failed or unpaid/i)
  })

  it('returns 400 when order is older than 24 hours', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const oldOrder = {
      ...recentFailedOrder,
      created_at: new Date(Date.now() - 25 * 3600000).toISOString(), // 25h ago
    }
    mockQueryOne.mockResolvedValue(oldOrder)
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'order-1' }) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/older than 24 hours/i)
  })

  it('sends retry email and returns success for failed payment', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(recentFailedOrder)
    mockSendEmail.mockResolvedValue({ success: true })

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'order-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(mockSendEmail).toHaveBeenCalledWith(
      'customer@example.com',
      'Jane Doe',
      'ORD-001',
      1500,
    )
  })

  it('sends retry email for unpaid status', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ ...recentFailedOrder, payment_status: 'unpaid' })
    mockSendEmail.mockResolvedValue({ success: true })

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'order-1' }) })
    expect(res.status).toBe(200)
  })

  it('returns 500 when email sending fails', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(recentFailedOrder)
    mockSendEmail.mockResolvedValue({ success: false })

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'order-1' }) })
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/failed to send/i)
  })
})
