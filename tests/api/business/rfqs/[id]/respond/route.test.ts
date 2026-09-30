/**
 * Tests for POST /api/business/rfqs/[id]/respond
 * src/app/api/business/rfqs/[id]/respond/route.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-bytes!!'

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const mockAuthenticateBusiness = vi.hoisted(() => vi.fn())
const mockQueryOne = vi.hoisted(() => vi.fn())
const mockQueryMany = vi.hoisted(() => vi.fn())
const mockQuery = vi.hoisted(() => vi.fn().mockResolvedValue({ rows: [] }))

vi.mock('@/lib/auth/jwt', () => ({
  authenticateBusiness: mockAuthenticateBusiness,
}))

vi.mock('@/lib/shared/db', () => ({
  query: mockQuery,
  queryOne: mockQueryOne,
  queryMany: mockQueryMany,
  queryCount: vi.fn(),
  withTransaction: vi.fn(),
}))

import { POST } from '@/app/api/(public)/business/rfqs/[id]/respond/route'

// ── helpers ───────────────────────────────────────────────────────────────────
const AUTH_USER = { userId: 'biz-1', email: 'biz@example.com', isBusiness: true, approvalStatus: 'approved' }
const RFQ_ID = 'rfq-uuid-1'
const NEGOTIATING_RFQ = { id: RFQ_ID, status: 'negotiating' }

function makePost(id: string, body: object) {
  return new Request(`http://localhost/api/business/rfqs/${id}/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ── tests ─────────────────────────────────────────────────────────────────────
describe('POST /api/business/rfqs/[id]/respond', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockQuery.mockResolvedValue({ rows: [] })
  })

  it('returns 401 when not authenticated', async () => {
    mockAuthenticateBusiness.mockResolvedValue(null)
    const res = await POST(makePost(RFQ_ID, { action: 'accept' }) as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(401)
  })

  it('returns 404 when rfq not found', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValue(null)
    const res = await POST(makePost(RFQ_ID, { action: 'accept' }) as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(404)
  })

  it('returns 400 when rfq status is not active for responding (converted)', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValue({ ...NEGOTIATING_RFQ, status: 'converted' })
    const res = await POST(makePost(RFQ_ID, { action: 'accept' }) as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/no active offer/i)
  })

  it('returns 400 when action is invalid', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValue(NEGOTIATING_RFQ)
    const res = await POST(makePost(RFQ_ID, { action: 'maybe' }) as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/action must be accept or decline/i)
  })

  it('accepts offer — sets status to offer_accepted', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_USER)
    mockQueryOne
      .mockResolvedValueOnce(NEGOTIATING_RFQ) // rfq check
      .mockResolvedValueOnce(null) // no latest admin offer
    const res = await POST(makePost(RFQ_ID, { action: 'accept' }) as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.action).toBe('accept')
    expect(body.newStatus).toBe('offer_accepted')
    expect(mockQuery).toHaveBeenCalledWith(expect.stringMatching(/UPDATE business_rfqs SET status/), [
      'offer_accepted',
      RFQ_ID,
    ])
  })

  it('accept uses custom message when provided', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValueOnce(NEGOTIATING_RFQ).mockResolvedValueOnce(null)
    const res = await POST(makePost(RFQ_ID, { action: 'accept', message: 'Great, proceed!' }) as any, {
      params: Promise.resolve({ id: RFQ_ID }),
    })
    expect(res.status).toBe(200)
    const insertCall = mockQuery.mock.calls.find(
      (c: any) => typeof c[0] === 'string' && c[0].includes('INSERT INTO rfq_messages')
    )
    expect(insertCall![1][1]).toBe('Great, proceed!')
  })

  it('declines offer — sets status to negotiating', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValueOnce(NEGOTIATING_RFQ)
    const res = await POST(makePost(RFQ_ID, { action: 'decline' }) as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.action).toBe('decline')
    expect(body.newStatus).toBe('negotiating')
  })

  it('stamps accepted prices onto rfq items when admin has counter_items', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_USER)
    const adminOffer = {
      counter_items: JSON.stringify([{ rfq_item_id: 'item-1', offered_price: 75 }]),
    }
    mockQueryOne.mockResolvedValueOnce(NEGOTIATING_RFQ).mockResolvedValueOnce(adminOffer)
    const res = await POST(makePost(RFQ_ID, { action: 'accept' }) as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(200)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringMatching(/UPDATE business_rfq_items SET requested_price/), [
      75,
      'item-1',
      RFQ_ID,
    ])
  })

  it('stamps accepted prices when counter_items is already an array (not JSON string)', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_USER)
    const adminOffer = {
      counter_items: [{ rfq_item_id: 'item-2', offered_price: 50 }],
    }
    mockQueryOne.mockResolvedValueOnce(NEGOTIATING_RFQ).mockResolvedValueOnce(adminOffer)
    const res = await POST(makePost(RFQ_ID, { action: 'accept' }) as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(200)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringMatching(/UPDATE business_rfq_items SET requested_price/), [
      50,
      'item-2',
      RFQ_ID,
    ])
  })

  it('returns 400 when decline counter_items is not an array', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValue(NEGOTIATING_RFQ)
    const res = await POST(
      makePost(RFQ_ID, {
        action: 'decline',
        counter_items: 'not-array',
      }) as any,
      { params: Promise.resolve({ id: RFQ_ID }) }
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/must be an array/i)
  })

  it('returns 400 when decline counter_items item is invalid', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValue(NEGOTIATING_RFQ)
    const res = await POST(
      makePost(RFQ_ID, {
        action: 'decline',
        counter_items: [{ rfq_item_id: null, offered_price: 10 }],
      }) as any,
      { params: Promise.resolve({ id: RFQ_ID }) }
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 when decline counter_items reference non-existent rfq items', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValue(NEGOTIATING_RFQ)
    // only 1 row returned for 2 ids
    mockQueryMany.mockResolvedValueOnce([{ id: 'item-1' }])
    const res = await POST(
      makePost(RFQ_ID, {
        action: 'decline',
        counter_items: [
          { rfq_item_id: 'item-1', offered_price: 10 },
          { rfq_item_id: 'item-2', offered_price: 20 },
        ],
      }) as any,
      { params: Promise.resolve({ id: RFQ_ID }) }
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/do not belong/i)
  })

  it('handles valid decline with counter_items', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockResolvedValue(NEGOTIATING_RFQ)
    mockQueryMany.mockResolvedValueOnce([{ id: 'item-1' }])
    const res = await POST(
      makePost(RFQ_ID, {
        action: 'decline',
        counter_items: [{ rfq_item_id: 'item-1', offered_price: 80 }],
      }) as any,
      { params: Promise.resolve({ id: RFQ_ID }) }
    )
    expect(res.status).toBe(200)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringMatching(/INSERT INTO rfq_messages/), expect.any(Array))
  })

  it('returns 500 on unexpected error', async () => {
    mockAuthenticateBusiness.mockResolvedValue(AUTH_USER)
    mockQueryOne.mockRejectedValue(new Error('unexpected db error'))
    const res = await POST(makePost(RFQ_ID, { action: 'accept' }) as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(500)
  })
})
