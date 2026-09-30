import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({
  requireAdminScope: vi.fn(),
}))

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { GET, PATCH } from '@/app/api/(admin)/admin/business/rfqs/[id]/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { query, queryOne, queryMany } from '@/lib/shared/db'

const mockRequireScope = vi.mocked(requireAdminScope)
const mockQuery = vi.mocked(query)
const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)

const adminPayload = {
  adminId: 'admin-1',
  username: 'testadmin',
  role: 'super_admin',
  scopes: ['business_rfqs'],
}

function makeGetRequest(id = 'rfq-1') {
  return new NextRequest(`http://localhost/api/admin/business/rfqs/${id}`, {
    method: 'GET',
    headers: { cookie: 'admin_sid=valid' },
  })
}

function makePatchRequest(id = 'rfq-1', body: Record<string, unknown> = {}) {
  return new NextRequest(`http://localhost/api/admin/business/rfqs/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: 'admin_sid=valid' },
    body: JSON.stringify(body),
  })
}

const sampleRfq = {
  id: 'rfq-1',
  rfq_number: 'RFQ-001',
  status: 'open',
  user_id: 'user-1',
}

const sampleItems = [{ id: 'ri-1', rfq_id: 'rfq-1', product_id: 'p-1', quantity: 5 }]
const sampleDiscounts = [{ category_id: 'cat-1', discount_pct: '10' }]

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/business/rfqs/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401/403 when requireAdminScope rejects', async () => {
    mockRequireScope.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const res = await GET(makeGetRequest(), { params: Promise.resolve({ id: 'rfq-1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 404 when RFQ not found', async () => {
    mockRequireScope.mockResolvedValue(adminPayload as any)
    mockQueryOne.mockResolvedValue(null)
    const res = await GET(makeGetRequest('rfq-999'), { params: Promise.resolve({ id: 'rfq-999' }) })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/not found/i)
  })

  it('returns rfq, items and discountMap on success', async () => {
    mockRequireScope.mockResolvedValue(adminPayload as any)
    mockQueryOne.mockResolvedValue(sampleRfq)
    mockQueryMany.mockResolvedValueOnce(sampleItems).mockResolvedValueOnce(sampleDiscounts)

    const res = await GET(makeGetRequest(), { params: Promise.resolve({ id: 'rfq-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rfq).toEqual(sampleRfq)
    expect(body.items).toHaveLength(1)
    expect(body.discountMap).toEqual({ 'cat-1': 10 })
  })

  it('returns empty discountMap when no discounts', async () => {
    mockRequireScope.mockResolvedValue(adminPayload as any)
    mockQueryOne.mockResolvedValue(sampleRfq)
    mockQueryMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    const res = await GET(makeGetRequest(), { params: Promise.resolve({ id: 'rfq-1' }) })
    const body = await res.json()
    expect(body.discountMap).toEqual({})
  })
})

describe('PATCH /api/admin/business/rfqs/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401/403 when requireAdminScope rejects', async () => {
    mockRequireScope.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const res = await PATCH(makePatchRequest(), { params: Promise.resolve({ id: 'rfq-1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid status', async () => {
    mockRequireScope.mockResolvedValue(adminPayload as any)
    const res = await PATCH(makePatchRequest('rfq-1', { status: 'invalid' }), {
      params: Promise.resolve({ id: 'rfq-1' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/invalid status/i)
  })

  it('updates RFQ to reviewed status', async () => {
    mockRequireScope.mockResolvedValue(adminPayload as any)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

    const res = await PATCH(makePatchRequest('rfq-1', { status: 'reviewed', adminNote: 'Looks good' }), {
      params: Promise.resolve({ id: 'rfq-1' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE business_rfqs'),
      expect.arrayContaining(['reviewed', 'Looks good', 'rfq-1'])
    )
  })

  it('updates RFQ to rejected status', async () => {
    mockRequireScope.mockResolvedValue(adminPayload as any)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

    const res = await PATCH(makePatchRequest('rfq-1', { status: 'rejected' }), {
      params: Promise.resolve({ id: 'rfq-1' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })
})
