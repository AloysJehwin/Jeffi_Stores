import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/db', () => ({ query: vi.fn(), queryOne: vi.fn() }))
vi.mock('@/lib/email-business', () => ({
  sendBusinessAccountApprovedEmail: vi.fn(),
  sendBusinessAccountRejectedEmail: vi.fn(),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/business/customers/[id]/approve/route'
import { requireAdminScope } from '@/lib/jwt'
import { query, queryOne } from '@/lib/db'
import { sendBusinessAccountApprovedEmail, sendBusinessAccountRejectedEmail } from '@/lib/email-business'

const mockRequireScope = vi.mocked(requireAdminScope)
const mockQuery = vi.mocked(query)
const mockQueryOne = vi.mocked(queryOne)
const mockSendApproved = vi.mocked(sendBusinessAccountApprovedEmail)
const mockSendRejected = vi.mocked(sendBusinessAccountRejectedEmail)

const adminPayload = { adminId: 'admin-1', username: 'a', role: 'super_admin', scopes: ['business_customers'] }

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/admin/business/customers/user-1/approve', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'admin_sid=valid' },
    body: JSON.stringify(body),
  })
}

const params = { params: Promise.resolve({ id: 'user-1' }) }

// ── Tests: target uncovered fallback branches on lines 36-46 ────────────────────

describe('POST business/customers approve — name/company/note fallbacks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
  })

  it('falls back to email as the name when both first and last names are null (approve)', async () => {
    mockRequireScope.mockResolvedValue(adminPayload as any)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'bp-1' })
      .mockResolvedValueOnce({ email: 'c@example.com', first_name: null, last_name: null, company_name: null })
    mockSendApproved.mockResolvedValue(undefined as any)

    const res = await POST(makeRequest({ action: 'approve' }), params)
    expect(res.status).toBe(200)
    // name → email fallback, company_name → '' fallback
    expect(mockSendApproved).toHaveBeenCalledWith('c@example.com', 'c@example.com', '')
  })

  it('uses only first name when last name is null (approve)', async () => {
    mockRequireScope.mockResolvedValue(adminPayload as any)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'bp-1' })
      .mockResolvedValueOnce({ email: 'c@example.com', first_name: 'Jane', last_name: null, company_name: 'Acme' })
    mockSendApproved.mockResolvedValue(undefined as any)

    await POST(makeRequest({ action: 'approve' }), params)
    expect(mockSendApproved).toHaveBeenCalledWith('c@example.com', 'Jane', 'Acme')
  })

  it('falls back to email as the name and passes null note when rejecting without a note', async () => {
    mockRequireScope.mockResolvedValue(adminPayload as any)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'bp-1' })
      .mockResolvedValueOnce({ email: 'c@example.com', first_name: null, last_name: null, company_name: null })
    mockSendRejected.mockResolvedValue(undefined as any)

    const res = await POST(makeRequest({ action: 'reject' }), params)
    expect(res.status).toBe(200)
    // rejectionNote → null in UPDATE, name → email, company → ''
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("approval_status='rejected'"),
      ['admin-1', null, 'user-1'],
    )
    expect(mockSendRejected).toHaveBeenCalledWith('c@example.com', 'c@example.com', '', null)
  })

  it('reject skips email send when userInfo has no email', async () => {
    mockRequireScope.mockResolvedValue(adminPayload as any)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'bp-1' })
      .mockResolvedValueOnce({ email: null, first_name: 'X', last_name: 'Y', company_name: 'Z' })

    const res = await POST(makeRequest({ action: 'reject', rejectionNote: 'bad' }), params)
    expect(res.status).toBe(200)
    expect(mockSendRejected).not.toHaveBeenCalled()
  })

  it('reject skips email send when userInfo row is null entirely', async () => {
    mockRequireScope.mockResolvedValue(adminPayload as any)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'bp-1' })
      .mockResolvedValueOnce(null)

    const res = await POST(makeRequest({ action: 'reject', rejectionNote: 'bad' }), params)
    expect(res.status).toBe(200)
    expect(mockSendRejected).not.toHaveBeenCalled()
  })
})
