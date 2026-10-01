/**
 * Tests for GET/POST /api/business/rfqs
 * src/app/api/business/rfqs/route.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-bytes!!'

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const mockAuthenticateBusiness = vi.hoisted(() => vi.fn())
const mockQueryMany = vi.hoisted(() => vi.fn())
const mockQueryCount = vi.hoisted(() => vi.fn())
const mockQuery = vi.hoisted(() => vi.fn().mockResolvedValue({ rows: [] }))
const mockQueryOne = vi.hoisted(() => vi.fn())
const mockSendRfqSubmittedEmail = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('@/lib/auth/jwt', () => ({
  authenticateBusiness: mockAuthenticateBusiness,
}))

vi.mock('@/lib/shared/db', () => ({
  query: mockQuery,
  queryOne: mockQueryOne,
  queryMany: mockQueryMany,
  queryCount: mockQueryCount,
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/shared/email-business', () => ({
  sendRfqSubmittedEmail: mockSendRfqSubmittedEmail,
}))

import { GET, POST } from '@/app/api/(public)/business/rfqs/route'

// ── helpers ───────────────────────────────────────────────────────────────────
const APPROVED_USER = {
  userId: 'biz-1',
  email: 'biz@example.com',
  isBusiness: true,
  approvalStatus: 'approved',
}

const PENDING_USER = { ...APPROVED_USER, approvalStatus: 'pending' }

function makeGet(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/business/rfqs')
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  return new Request(url.toString(), { method: 'GET' })
}

function makePost(body: object) {
  return new Request('http://localhost/api/business/rfqs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const SAMPLE_ITEMS = [{ productId: null, variantId: null, description: 'Item A', quantity: 2, unit: 'Nos' }]

const NEW_RFQ = { id: 'rfq-1', rfq_number: 'RFQ/25-26/JAN/1', user_id: 'biz-1', notes: null }

// ── GET ───────────────────────────────────────────────────────────────────────
describe('GET /api/business/rfqs', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockQuery.mockResolvedValue({ rows: [] })
  })

  it('returns 401 when not authenticated', async () => {
    mockAuthenticateBusiness.mockResolvedValue(null)
    const res = await GET(makeGet() as any)
    expect(res.status).toBe(401)
  })

  it('returns 403 when user is not approved', async () => {
    mockAuthenticateBusiness.mockResolvedValue(PENDING_USER)
    const res = await GET(makeGet() as any)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/pending approval/i)
  })

  it('returns paginated rfq list', async () => {
    mockAuthenticateBusiness.mockResolvedValue(APPROVED_USER)
    const rfqs = [{ id: 'rfq-1', rfq_number: 'RFQ/25-26/JAN/1', status: 'pending' }]
    mockQueryMany.mockResolvedValue(rfqs)
    mockQueryCount.mockResolvedValue(1)
    const res = await GET(makeGet() as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rfqs).toHaveLength(1)
    expect(body.total).toBe(1)
    expect(body.page).toBe(1)
    expect(body.pageSize).toBe(20)
  })

  it('handles page param correctly', async () => {
    mockAuthenticateBusiness.mockResolvedValue(APPROVED_USER)
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    const res = await GET(makeGet({ page: '2' }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.page).toBe(2)
  })

  it('clamps page to 1 for invalid page param', async () => {
    mockAuthenticateBusiness.mockResolvedValue(APPROVED_USER)
    mockQueryMany.mockResolvedValue([])
    mockQueryCount.mockResolvedValue(0)
    const res = await GET(makeGet({ page: '-5' }) as any)
    const body = await res.json()
    expect(body.page).toBe(1)
  })
})

// ── POST ──────────────────────────────────────────────────────────────────────
describe('POST /api/business/rfqs', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockQuery.mockResolvedValue({ rows: [] })
    mockSendRfqSubmittedEmail.mockResolvedValue(undefined)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuthenticateBusiness.mockResolvedValue(null)
    const res = await POST(makePost({ items: SAMPLE_ITEMS }) as any)
    expect(res.status).toBe(401)
  })

  it('returns 403 when user is not approved', async () => {
    mockAuthenticateBusiness.mockResolvedValue(PENDING_USER)
    const res = await POST(makePost({ items: SAMPLE_ITEMS }) as any)
    expect(res.status).toBe(403)
  })

  it('returns 400 when items is empty', async () => {
    mockAuthenticateBusiness.mockResolvedValue(APPROVED_USER)
    const res = await POST(makePost({ items: [] }) as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/at least one item/i)
  })

  it('returns 400 when items is missing', async () => {
    mockAuthenticateBusiness.mockResolvedValue(APPROVED_USER)
    const res = await POST(makePost({}) as any)
    expect(res.status).toBe(400)
  })

  it('returns 400 when items is not an array', async () => {
    mockAuthenticateBusiness.mockResolvedValue(APPROVED_USER)
    const res = await POST(makePost({ items: 'bad' }) as any)
    expect(res.status).toBe(400)
  })

  it('creates RFQ with items and returns 201', async () => {
    mockAuthenticateBusiness.mockResolvedValue(APPROVED_USER)
    mockQueryOne
      .mockResolvedValueOnce({ max_seq: '5' }) // max seq lookup
      .mockResolvedValueOnce(NEW_RFQ) // rfq insert
      .mockResolvedValueOnce({ first_name: 'Biz', last_name: 'Owner' }) // user profile
    const res = await POST(makePost({ items: SAMPLE_ITEMS }) as any)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.rfq).toMatchObject({ id: 'rfq-1' })
    expect(mockSendRfqSubmittedEmail).toHaveBeenCalled()
  })

  it('starts RFQ sequence at 1 when no existing RFQs in this period', async () => {
    mockAuthenticateBusiness.mockResolvedValue(APPROVED_USER)
    mockQueryOne
      .mockResolvedValueOnce({ max_seq: null }) // no existing RFQs
      .mockResolvedValueOnce(NEW_RFQ)
      .mockResolvedValueOnce(null) // user profile not found
    const res = await POST(makePost({ items: SAMPLE_ITEMS, notes: 'Test notes' }) as any)
    expect(res.status).toBe(201)
    // rfq_number should have /1 suffix when no prior exists
    const insertParams = mockQueryOne.mock.calls[1][1]
    expect(Array.isArray(insertParams) ? insertParams[0] : insertParams).toMatch(/\/1$/)
  })

  it('inserts each item via query', async () => {
    mockAuthenticateBusiness.mockResolvedValue(APPROVED_USER)
    const items = [
      { description: 'Item A', quantity: 1 },
      { description: 'Item B', quantity: 3 },
    ]
    mockQueryOne
      .mockResolvedValueOnce({ max_seq: '0' })
      .mockResolvedValueOnce(NEW_RFQ)
      .mockResolvedValueOnce({ first_name: 'Biz', last_name: null })
    const res = await POST(makePost({ items }) as any)
    expect(res.status).toBe(201)
    // 2 item inserts + any other queries
    const itemInserts = mockQuery.mock.calls.filter(
      (c: any) => typeof c[0] === 'string' && c[0].includes('business_rfq_items')
    )
    expect(itemInserts).toHaveLength(2)
  })
})
