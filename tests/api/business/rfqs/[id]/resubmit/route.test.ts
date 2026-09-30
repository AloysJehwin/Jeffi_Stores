/**
 * Tests for POST /api/business/rfqs/[id]/resubmit
 * src/app/api/business/rfqs/[id]/resubmit/route.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-bytes!!'

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const mockAuthenticateBusiness = vi.hoisted(() => vi.fn())
const mockQueryOne = vi.hoisted(() => vi.fn())
const mockQueryMany = vi.hoisted(() => vi.fn())
const mockQuery = vi.hoisted(() => vi.fn().mockResolvedValue({ rows: [] }))
const mockSendRfqSubmittedEmail = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

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

vi.mock('@/lib/shared/email-business', () => ({
  sendRfqSubmittedEmail: mockSendRfqSubmittedEmail,
}))

import { POST } from '@/app/api/business/rfqs/[id]/resubmit/route'

// ── helpers ───────────────────────────────────────────────────────────────────
const APPROVED_USER = {
  userId: 'biz-1',
  email: 'biz@example.com',
  isBusiness: true,
  approvalStatus: 'approved',
}
const PENDING_USER = { ...APPROVED_USER, approvalStatus: 'pending' }
const RFQ_ID = 'rfq-src-1'

const REJECTED_RFQ = {
  id: RFQ_ID,
  rfq_number: 'RFQ/25-26/JAN/3',
  status: 'rejected',
  notes: 'Original note',
}

const SOURCE_ITEMS = [
  {
    product_id: null,
    variant_id: null,
    sub_variant_id: null,
    description: 'Bolt',
    quantity: 5,
    unit: 'Nos',
    requested_price: 10,
    notes: null,
    position: 0,
  },
]

const NEW_RFQ = { id: 'rfq-new-1', rfq_number: 'RFQ/25-26/JAN/4', user_id: 'biz-1' }

function makePost(id: string, body: object = {}) {
  return new Request(`http://localhost/api/business/rfqs/${id}/resubmit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ── tests ─────────────────────────────────────────────────────────────────────
describe('POST /api/business/rfqs/[id]/resubmit', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockQuery.mockResolvedValue({ rows: [] })
    mockSendRfqSubmittedEmail.mockResolvedValue(undefined)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuthenticateBusiness.mockResolvedValue(null)
    const res = await POST(makePost(RFQ_ID) as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 when user is not approved', async () => {
    mockAuthenticateBusiness.mockResolvedValue(PENDING_USER)
    const res = await POST(makePost(RFQ_ID) as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/pending approval/i)
  })

  it('returns 404 when source rfq not found', async () => {
    mockAuthenticateBusiness.mockResolvedValue(APPROVED_USER)
    mockQueryOne.mockResolvedValue(null)
    const res = await POST(makePost(RFQ_ID) as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(404)
  })

  it('returns 400 when source rfq is not rejected', async () => {
    mockAuthenticateBusiness.mockResolvedValue(APPROVED_USER)
    mockQueryOne.mockResolvedValue({ ...REJECTED_RFQ, status: 'pending' })
    const res = await POST(makePost(RFQ_ID) as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/only rejected rfqs can be resubmitted/i)
  })

  it('returns 400 when source rfq has no items', async () => {
    mockAuthenticateBusiness.mockResolvedValue(APPROVED_USER)
    mockQueryOne.mockResolvedValue(REJECTED_RFQ)
    mockQueryMany.mockResolvedValue([]) // no items
    const res = await POST(makePost(RFQ_ID) as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/no items/i)
  })

  it('creates new rfq copying items from rejected rfq', async () => {
    mockAuthenticateBusiness.mockResolvedValue(APPROVED_USER)
    mockQueryOne
      .mockResolvedValueOnce(REJECTED_RFQ) // source rfq
      .mockResolvedValueOnce({ max_seq: '3' }) // max seq
      .mockResolvedValueOnce(NEW_RFQ) // insert
      .mockResolvedValueOnce({ first_name: 'Biz', last_name: 'Owner' }) // user profile
    mockQueryMany.mockResolvedValue(SOURCE_ITEMS)
    const res = await POST(makePost(RFQ_ID) as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.rfq.id).toBe('rfq-new-1')
    expect(mockSendRfqSubmittedEmail).toHaveBeenCalledWith(APPROVED_USER.email, 'Biz Owner', NEW_RFQ.rfq_number)
  })

  it('sets notes to "Resubmitted from ..." with original notes when no additional notes given', async () => {
    mockAuthenticateBusiness.mockResolvedValue(APPROVED_USER)
    mockQueryOne
      .mockResolvedValueOnce(REJECTED_RFQ)
      .mockResolvedValueOnce({ max_seq: null })
      .mockResolvedValueOnce(NEW_RFQ)
      .mockResolvedValueOnce(null) // user profile not found
    mockQueryMany.mockResolvedValue(SOURCE_ITEMS)
    await POST(makePost(RFQ_ID) as any, { params: Promise.resolve({ id: RFQ_ID }) })
    // The INSERT call should contain combined notes
    const insertCall = mockQueryOne.mock.calls.find(
      (c: any) => typeof c[0] === 'string' && c[0].includes('INSERT INTO business_rfqs')
    )
    expect(insertCall![1][2]).toContain('Resubmitted from RFQ/25-26/JAN/3')
    expect(insertCall![1][2]).toContain('Original note')
  })

  it('prepends additional notes when body.notes is provided', async () => {
    mockAuthenticateBusiness.mockResolvedValue(APPROVED_USER)
    mockQueryOne
      .mockResolvedValueOnce(REJECTED_RFQ)
      .mockResolvedValueOnce({ max_seq: '0' })
      .mockResolvedValueOnce(NEW_RFQ)
      .mockResolvedValueOnce({ first_name: null, last_name: null })
    mockQueryMany.mockResolvedValue(SOURCE_ITEMS)
    await POST(makePost(RFQ_ID, { notes: 'Please reconsider pricing' }) as any, {
      params: Promise.resolve({ id: RFQ_ID }),
    })
    const insertCall = mockQueryOne.mock.calls.find(
      (c: any) => typeof c[0] === 'string' && c[0].includes('INSERT INTO business_rfqs')
    )
    expect(insertCall![1][2]).toContain('Please reconsider pricing')
  })

  it('uses email as display name when user profile has no names', async () => {
    mockAuthenticateBusiness.mockResolvedValue(APPROVED_USER)
    mockQueryOne
      .mockResolvedValueOnce(REJECTED_RFQ)
      .mockResolvedValueOnce({ max_seq: '5' })
      .mockResolvedValueOnce(NEW_RFQ)
      .mockResolvedValueOnce(null) // no user profile
    mockQueryMany.mockResolvedValue(SOURCE_ITEMS)
    await POST(makePost(RFQ_ID) as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(mockSendRfqSubmittedEmail).toHaveBeenCalledWith(
      APPROVED_USER.email,
      APPROVED_USER.email, // fallback to email
      NEW_RFQ.rfq_number
    )
  })

  it('inserts all source items into new rfq', async () => {
    mockAuthenticateBusiness.mockResolvedValue(APPROVED_USER)
    const twoItems = [
      { ...SOURCE_ITEMS[0], position: 0 },
      {
        product_id: null,
        variant_id: null,
        sub_variant_id: null,
        description: 'Nut',
        quantity: 10,
        unit: 'Pcs',
        requested_price: 5,
        notes: null,
        position: 1,
      },
    ]
    mockQueryOne
      .mockResolvedValueOnce(REJECTED_RFQ)
      .mockResolvedValueOnce({ max_seq: '2' })
      .mockResolvedValueOnce(NEW_RFQ)
      .mockResolvedValueOnce({ first_name: 'Biz', last_name: null })
    mockQueryMany.mockResolvedValue(twoItems)
    const res = await POST(makePost(RFQ_ID) as any, { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(201)
    const itemInserts = mockQuery.mock.calls.filter(
      (c: any) => typeof c[0] === 'string' && c[0].includes('business_rfq_items')
    )
    expect(itemInserts).toHaveLength(2)
  })
})
