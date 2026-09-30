import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({
  requireAdminScope: vi.fn(),
}))

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}))

vi.mock('@/lib/shared/email-business', () => ({
  sendBusinessAccountApprovedEmail: vi.fn(),
  sendBusinessAccountRejectedEmail: vi.fn(),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/business/customers/[id]/approve/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { query, queryOne } from '@/lib/shared/db'
import { sendBusinessAccountApprovedEmail, sendBusinessAccountRejectedEmail } from '@/lib/shared/email-business'

const mockRequireScope = vi.mocked(requireAdminScope)
const mockQuery = vi.mocked(query)
const mockQueryOne = vi.mocked(queryOne)
const mockSendApproved = vi.mocked(sendBusinessAccountApprovedEmail)
const mockSendRejected = vi.mocked(sendBusinessAccountRejectedEmail)

const adminPayload = {
  adminId: 'admin-1',
  username: 'testadmin',
  role: 'super_admin',
  scopes: ['business_customers'],
}

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/admin/business/customers/user-1/approve', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'admin_sid=valid' },
    body: JSON.stringify(body),
  })
}

const userInfo = {
  email: 'customer@example.com',
  first_name: 'Jane',
  last_name: 'Doe',
  company_name: 'Acme Corp',
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/business/customers/[id]/approve', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401/403 when requireAdminScope rejects', async () => {
    const unauthorizedResponse = NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    mockRequireScope.mockResolvedValue(unauthorizedResponse)
    const res = await POST(makeRequest({ action: 'approve' }), { params: Promise.resolve({ id: 'user-1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid action value', async () => {
    mockRequireScope.mockResolvedValue(adminPayload as any)
    const res = await POST(makeRequest({ action: 'invalid' }), { params: Promise.resolve({ id: 'user-1' }) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/approve.*reject/i)
  })

  it('returns 404 when business profile not found', async () => {
    mockRequireScope.mockResolvedValue(adminPayload as any)
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await POST(makeRequest({ action: 'approve' }), { params: Promise.resolve({ id: 'user-1' }) })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/not found/i)
  })

  it('approves the business profile and sends email', async () => {
    mockRequireScope.mockResolvedValue(adminPayload as any)
    mockQueryOne.mockResolvedValueOnce({ id: 'bp-1' }).mockResolvedValueOnce(userInfo)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    mockSendApproved.mockResolvedValue(undefined as any)

    const res = await POST(makeRequest({ action: 'approve' }), { params: Promise.resolve({ id: 'user-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.action).toBe('approve')
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("approval_status='approved'"), expect.any(Array))
  })

  it('rejects the business profile and sends rejection email', async () => {
    mockRequireScope.mockResolvedValue(adminPayload as any)
    mockQueryOne.mockResolvedValueOnce({ id: 'bp-1' }).mockResolvedValueOnce(userInfo)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    mockSendRejected.mockResolvedValue(undefined as any)

    const res = await POST(makeRequest({ action: 'reject', rejectionNote: 'Incomplete docs' }), {
      params: Promise.resolve({ id: 'user-1' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.action).toBe('reject')
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("approval_status='rejected'"),
      expect.arrayContaining(['Incomplete docs'])
    )
  })

  it('still succeeds when userInfo has no email (skips email send)', async () => {
    mockRequireScope.mockResolvedValue(adminPayload as any)
    mockQueryOne
      .mockResolvedValueOnce({ id: 'bp-1' })
      .mockResolvedValueOnce({ email: null, first_name: null, last_name: null, company_name: null })
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

    const res = await POST(makeRequest({ action: 'approve' }), { params: Promise.resolve({ id: 'user-1' }) })
    expect(res.status).toBe(200)
    expect(mockSendApproved).not.toHaveBeenCalled()
  })

  it('uses full name when both first and last names are present', async () => {
    mockRequireScope.mockResolvedValue(adminPayload as any)
    mockQueryOne.mockResolvedValueOnce({ id: 'bp-1' }).mockResolvedValueOnce(userInfo)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    mockSendApproved.mockResolvedValue(undefined as any)

    await POST(makeRequest({ action: 'approve' }), { params: Promise.resolve({ id: 'user-1' }) })

    expect(mockSendApproved).toHaveBeenCalledWith('customer@example.com', 'Jane Doe', 'Acme Corp')
  })
})

describe('POST business/customers approve — name/company/note fallbacks', () => {
  const params = { params: Promise.resolve({ id: 'user-1' }) }

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
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("approval_status='rejected'"), [
      'admin-1',
      null,
      'user-1',
    ])
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
    mockQueryOne.mockResolvedValueOnce({ id: 'bp-1' }).mockResolvedValueOnce(null)

    const res = await POST(makeRequest({ action: 'reject', rejectionNote: 'bad' }), params)
    expect(res.status).toBe(200)
    expect(mockSendRejected).not.toHaveBeenCalled()
  })
})
