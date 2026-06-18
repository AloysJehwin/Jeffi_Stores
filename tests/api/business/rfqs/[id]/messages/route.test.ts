/**
 * Tests for GET/POST /api/business/rfqs/[id]/messages
 * src/app/api/business/rfqs/[id]/messages/route.ts
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

import { GET, POST } from '@/app/api/business/rfqs/[id]/messages/route'

// ── helpers ───────────────────────────────────────────────────────────────────
const AUTH_USER = { userId: 'biz-1', email: 'biz@example.com', isBusiness: true, approvalStatus: 'approved' }
const RFQ_ID = 'rfq-uuid-1'
const OPEN_RFQ = { id: RFQ_ID, status: 'pending' }

function makeGet(id = RFQ_ID) {
  return new Request(`http://localhost/api/business/rfqs/${id}/messages`, { method: 'GET' })
}

function makePost(id: string, body: object) {
  return new Request(`http://localhost/api/business/rfqs/${id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ── GET ───────────────────────────────────────────────────────────────────────
describe('GET /api/business/rfqs/[id]/messages', () => {
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

  it('returns messages list on success', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValue(OPEN_RFQ)
    mockQueryMany.mockResolvedValue([
      { id: 'msg-1', sender: 'customer', message: 'Hello', created_at: new Date().toISOString() },
    ])
    const res = await GET(makeGet() as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.messages).toHaveLength(1)
  })

  it('returns empty messages array when none exist', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValue(OPEN_RFQ)
    mockQueryMany.mockResolvedValue([])
    const res = await GET(makeGet() as any, { params: Promise.resolve({ id: RFQ_ID }) })
    const body = await res.json()
    expect(body.messages).toHaveLength(0)
  })
})

// ── POST ──────────────────────────────────────────────────────────────────────
describe('POST /api/business/rfqs/[id]/messages', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockQuery.mockResolvedValue({ rows: [] })
  })

  it('returns 401 when not authenticated', async () => {
    mockAuthenticateBusiness.mockResolvedValue(null)
    const res = await POST(makePost(RFQ_ID, { message: 'hello' }) as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(401)
  })

  it('returns 404 when rfq not found', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValue(null)
    const res = await POST(makePost(RFQ_ID, { message: 'hello' }) as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(404)
  })

  it('returns 400 when rfq status is closed (converted)', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValue({ ...OPEN_RFQ, status: 'converted' })
    const res = await POST(makePost(RFQ_ID, { message: 'hello' }) as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/cannot message on a closed quote/i)
  })

  it('returns 400 when rfq status is rejected', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValue({ ...OPEN_RFQ, status: 'rejected' })
    const res = await POST(makePost(RFQ_ID, { message: 'hello' }) as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(400)
  })

  it('returns 400 when message is empty', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValue(OPEN_RFQ)
    const res = await POST(makePost(RFQ_ID, { message: '   ' }) as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(400)
  })

  it('inserts message and returns it on success', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_USER)
    const savedMsg = { id: 'msg-1', sender: 'customer', message: 'Need better price', created_at: new Date().toISOString(), counter_items: null }
    mockQueryOne
      .mockResolvedValueOnce(OPEN_RFQ)  // rfq check
      .mockResolvedValueOnce(savedMsg)  // message insert
    const res = await POST(makePost(RFQ_ID, { message: 'Need better price' }) as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message.id).toBe('msg-1')
  })

  it('updates status to negotiating when rfq was pending', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_USER)
    const savedMsg = { id: 'msg-1', sender: 'customer', message: 'Counter', created_at: new Date().toISOString() }
    mockQueryOne
      .mockResolvedValueOnce({ ...OPEN_RFQ, status: 'pending' })
      .mockResolvedValueOnce(savedMsg)
    const res = await POST(makePost(RFQ_ID, { message: 'Counter' }) as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(200)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE business_rfqs SET status = 'negotiating'/),
      expect.any(Array)
    )
  })

  it('does not update status to negotiating for negotiating rfq', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_USER)
    const savedMsg = { id: 'msg-1', sender: 'customer', message: 'More counter', created_at: new Date().toISOString() }
    mockQueryOne
      .mockResolvedValueOnce({ ...OPEN_RFQ, status: 'negotiating' })
      .mockResolvedValueOnce(savedMsg)
    const res = await POST(makePost(RFQ_ID, { message: 'More counter' }) as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(200)
    const statusUpdates = mockQuery.mock.calls.filter((c: any) =>
      typeof c[0] === 'string' && c[0].includes("status = 'negotiating'")
    )
    expect(statusUpdates).toHaveLength(0)
  })

  it('returns 400 when counter_items is not an array', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValue(OPEN_RFQ)
    const res = await POST(makePost(RFQ_ID, { message: 'offer', counter_items: 'bad' }) as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/must be an array/i)
  })

  it('returns 400 when counter_items entry is invalid', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValue(OPEN_RFQ)
    const res = await POST(makePost(RFQ_ID, {
      message: 'offer',
      counter_items: [{ rfq_item_id: null, offered_price: 10 }],
    }) as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(400)
  })

  it('returns 400 when counter_items reference items not in this rfq', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValue(OPEN_RFQ)
    // rows.length (1) !== ids.length (2) → mismatch
    mockQueryMany.mockResolvedValueOnce([{ id: 'item-1' }])
    const res = await POST(makePost(RFQ_ID, {
      message: 'counter',
      counter_items: [
        { rfq_item_id: 'item-1', offered_price: 10 },
        { rfq_item_id: 'item-2', offered_price: 20 },
      ],
    }) as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/do not belong/i)
  })

  it('accepts valid counter_items', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_USER)
    const savedMsg = { id: 'msg-2', sender: 'customer', message: 'counter', created_at: new Date().toISOString() }
    mockQueryOne
      .mockResolvedValueOnce(OPEN_RFQ)
      .mockResolvedValueOnce(savedMsg)
    mockQueryMany.mockResolvedValueOnce([{ id: 'item-1' }])
    const res = await POST(makePost(RFQ_ID, {
      message: 'counter offer',
      counter_items: [{ rfq_item_id: 'item-1', offered_price: 50 }],
    }) as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(200)
  })
})
