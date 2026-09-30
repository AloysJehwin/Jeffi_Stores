/**
 * Tests for GET/PATCH /api/business/rfqs/[id]
 * src/app/api/business/rfqs/[id]/route.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-bytes!!'

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const mockAuthenticateBusiness = vi.hoisted(() => vi.fn())
const mockQueryOne = vi.hoisted(() => vi.fn())
const mockQueryMany = vi.hoisted(() => vi.fn())
const mockQuery = vi.hoisted(() => vi.fn().mockResolvedValue({ rows: [] }))

vi.mock('@/lib/jwt', () => ({
  authenticateBusiness: mockAuthenticateBusiness,
}))

vi.mock('@/lib/db', () => ({
  query: mockQuery,
  queryOne: mockQueryOne,
  queryMany: mockQueryMany,
  queryCount: vi.fn(),
  withTransaction: vi.fn(),
}))

import { GET, PATCH } from '@/app/api/business/rfqs/[id]/route'

// ── helpers ───────────────────────────────────────────────────────────────────
const AUTH_USER = { userId: 'biz-1', email: 'biz@example.com', isBusiness: true, approvalStatus: 'approved' }
const RFQ_ID = 'rfq-uuid-1'

const SAMPLE_RFQ = {
  id: RFQ_ID,
  rfq_number: 'RFQ/25-26/JAN/1',
  status: 'pending',
  notes: null,
  admin_note: null,
  created_at: new Date().toISOString(),
  converted_quotation_id: null,
  quotation_view_token: null,
  quote_number: null,
  converted_order_id: null,
}

function makeGet(id = RFQ_ID) {
  return new Request(`http://localhost/api/business/rfqs/${id}`, { method: 'GET' })
}

function makePatch(id: string, body: object) {
  return new Request(`http://localhost/api/business/rfqs/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ── GET ───────────────────────────────────────────────────────────────────────
describe('GET /api/business/rfqs/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockQuery.mockResolvedValue({ rows: [] })
  })

  it('returns 401 when not authenticated', async () => {
    mockAuthenticateBusiness.mockResolvedValue(null)
    const res = await GET(makeGet() as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(401)
  })

  it('returns 404 when rfq not found', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValue(null)
    const res = await GET(makeGet() as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(404)
  })

  it('returns rfq with items, discounts and null order when no converted order', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValue(SAMPLE_RFQ)
    mockQueryMany
      .mockResolvedValueOnce([{ id: 'item-1', description: 'Bolt', quantity: 10 }]) // items
      .mockResolvedValueOnce([{ category_id: 'cat-1', discount_pct: '5.00' }]) // discounts
    const res = await GET(makeGet() as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rfq.id).toBe(RFQ_ID)
    expect(body.items).toHaveLength(1)
    expect(body.order).toBeNull()
    expect(body.discountMap).toMatchObject({ 'cat-1': 5 })
  })

  it('fetches order when rfq has converted_order_id', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_USER)
    const rfqWithOrder = { ...SAMPLE_RFQ, converted_order_id: 'order-1' }
    const order = { id: 'order-1', order_number: 'ORD-001', payment_status: 'paid' }
    mockQueryOne
      .mockResolvedValueOnce(rfqWithOrder) // rfq
      .mockResolvedValueOnce(order) // order
    mockQueryMany
      .mockResolvedValueOnce([]) // items
      .mockResolvedValueOnce([]) // discounts
    const res = await GET(makeGet() as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.order).toMatchObject({ id: 'order-1' })
  })
})

// ── PATCH ─────────────────────────────────────────────────────────────────────
describe('PATCH /api/business/rfqs/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockQuery.mockResolvedValue({ rows: [] })
  })

  it('returns 401 when not authenticated', async () => {
    mockAuthenticateBusiness.mockResolvedValue(null)
    const res = await PATCH(makePatch(RFQ_ID, {}) as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(401)
  })

  it('returns 404 when rfq not found', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValue(null)
    const res = await PATCH(makePatch(RFQ_ID, { notes: 'update' }) as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(404)
  })

  it('returns 400 when rfq status is not editable (converted)', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValue({ ...SAMPLE_RFQ, status: 'converted' })
    const res = await PATCH(makePatch(RFQ_ID, { notes: 'update' }) as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/cannot edit/i)
  })

  it('returns 400 for rejected status', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValue({ ...SAMPLE_RFQ, status: 'rejected' })
    const res = await PATCH(makePatch(RFQ_ID, {}) as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(400)
  })

  it('updates notes when provided', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValue({ ...SAMPLE_RFQ, status: 'pending' })
    const res = await PATCH(makePatch(RFQ_ID, { notes: 'Updated notes' }) as any, {
      params: Promise.resolve({ id: RFQ_ID }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringMatching(/UPDATE business_rfqs SET notes/), expect.any(Array))
  })

  it('updates items when provided', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValue({ ...SAMPLE_RFQ, status: 'negotiating' })
    const items = [{ id: 'item-1', quantity: 5, requested_price: 100, notes: 'urgent' }]
    const res = await PATCH(makePatch(RFQ_ID, { items }) as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(200)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringMatching(/UPDATE business_rfq_items/), expect.any(Array))
  })

  it('skips item update when item has no id', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValue({ ...SAMPLE_RFQ, status: 'reviewed' })
    const items = [{ quantity: 5 }] // no id
    const res = await PATCH(makePatch(RFQ_ID, { items }) as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(200)
    // No item update query should have been called
    const itemUpdates = mockQuery.mock.calls.filter(
      (c: any) => typeof c[0] === 'string' && c[0].includes('UPDATE business_rfq_items')
    )
    expect(itemUpdates).toHaveLength(0)
  })

  it('does not update notes when not in payload', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValue({ ...SAMPLE_RFQ, status: 'pending' })
    const res = await PATCH(makePatch(RFQ_ID, {}) as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(200)
    const noteUpdates = mockQuery.mock.calls.filter(
      (c: any) => typeof c[0] === 'string' && c[0].includes('UPDATE business_rfqs SET notes')
    )
    expect(noteUpdates).toHaveLength(0)
  })
})
