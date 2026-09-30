import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/auth/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/shared/db', () => ({
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))

vi.mock('@/lib/email', () => ({
  sendPurchaseOrderEmail: vi.fn(),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/inventory/po/[id]/resend-email/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, queryMany } from '@/lib/shared/db'
import { sendPurchaseOrderEmail } from '@/lib/email'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)
const mockSendPOEmail = vi.mocked(sendPurchaseOrderEmail)

const adminPayload = {
  adminId: 'admin-1',
  username: 'testadmin',
  role: 'super_admin',
  scopes: ['inventory'],
}

function makeRequest(id = 'po-1') {
  return new NextRequest(`http://localhost/api/admin/inventory/po/${id}/resend-email`, {
    method: 'POST',
    headers: { cookie: 'admin_sid=valid' },
  })
}

const samplePO = {
  id: 'po-1',
  po_number: 'PO-001',
  total_amount: '5000.00',
  view_token: 'token-abc',
  supplier_name: 'Supplier Co',
  contact_name: 'John Supplier',
  supplier_email: 'supplier@example.com',
}

const sampleItems = [{ product_name: 'Widget', variant_name: null, quantity: '10', unit_cost: '500.00' }]

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/inventory/po/[id]/resend-email', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'po-1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope is insufficient', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'po-1' }) })
    expect(res.status).toBe(403)
  })

  it('returns 404 when PO not found', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)
    const res = await POST(makeRequest('po-999'), { params: Promise.resolve({ id: 'po-999' }) })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/not found/i)
  })

  it('returns 400 when supplier has no email', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ ...samplePO, supplier_email: null })
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'po-1' }) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/no email/i)
  })

  it('sends PO email and returns success', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(samplePO)
    mockQueryMany.mockResolvedValue(sampleItems)
    mockSendPOEmail.mockResolvedValue(undefined as any)

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'po-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(mockSendPOEmail).toHaveBeenCalledWith(
      'supplier@example.com',
      'John Supplier',
      'Supplier Co',
      'PO-001',
      5000,
      expect.any(Array),
      expect.stringContaining('token-abc')
    )
  })

  it('returns 500 on email send error', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(samplePO)
    mockQueryMany.mockResolvedValue(sampleItems)
    mockSendPOEmail.mockRejectedValue(new Error('SMTP error'))

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'po-1' }) })
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/SMTP error/i)
  })
})
