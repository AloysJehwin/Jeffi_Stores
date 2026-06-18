import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/jwt', () => ({
  authenticateAnyUser: vi.fn(),
}))
vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))
vi.mock('@/lib/email', () => ({
  sendReturnStatusEmail: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/activity', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/auto-tasks', () => ({
  createAutoTask: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/return-policy', () => ({
  checkReturnEligibility: vi.fn(),
}))

import { GET, POST } from '@/app/api/orders/[id]/return/route'
import * as jwt from '@/lib/jwt'
import * as db from '@/lib/db'
import * as returnPolicy from '@/lib/return-policy'

// ------------------------------------------------------------------ helpers

function makeRequest(body: unknown = {}) {
  return new Request('http://localhost/api/orders/order-123/return', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const AUTH_USER = { userId: 'user-456', email: 'test@example.com' }
const PARAMS = { params: { id: 'order-123' } }

const DELIVERED_ORDER = {
  id: 'order-123',
  status: 'delivered',
  order_number: 'ORD-001',
  delivered_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago
  updated_at: new Date().toISOString(),
  user_id: 'user-456',
  customer_name: 'Test User',
  customer_email: 'test@example.com',
  first_name: 'Test',
  last_name: 'User',
  user_email: 'test@example.com',
}

const VALID_BODY = {
  type: 'refund',
  reason: 'defective',
  description: 'Item arrived broken',
}

function makeGetRequest() {
  return new Request('http://localhost/api/orders/order-123/return', {
    method: 'GET',
  })
}

describe('GET /api/orders/[id]/return', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(null)
    const res = await GET(makeGetRequest() as any, PARAMS)
    const body = await res.json()
    expect(res.status).toBe(401)
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns returnRequest and monthlyLimitReached=false when no returns this month', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(null)              // no return request
      .mockResolvedValueOnce({ cnt: '0' })      // monthly count = 0
    const res = await GET(makeGetRequest() as any, PARAMS)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.returnRequest).toBeNull()
    expect(body.monthlyLimitReached).toBe(false)
  })

  it('returns existing returnRequest and monthlyLimitReached=true when limit reached', async () => {
    const existingReturn = { id: 'rr-1', order_id: 'order-123', type: 'refund', status: 'pending' }
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(existingReturn)    // return request exists
      .mockResolvedValueOnce({ cnt: '1' })      // monthly count = 1 (limit)
    const res = await GET(makeGetRequest() as any, PARAMS)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.returnRequest).toEqual(existingReturn)
    expect(body.monthlyLimitReached).toBe(true)
  })

  it('returns 500 on database error', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockRejectedValue(new Error('DB error'))
    const res = await GET(makeGetRequest() as any, PARAMS)
    expect(res.status).toBe(500)
  })
})

// ------------------------------------------------------------------ tests

describe('POST /api/orders/[id]/return', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(null)

    const res = await POST(makeRequest(VALID_BODY) as any, PARAMS)
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 400 when type is invalid', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)

    const res = await POST(makeRequest({ type: 'exchange', reason: 'defective' }) as any, PARAMS)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/invalid type/i)
  })

  it('returns 400 when reason is invalid', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)

    const res = await POST(makeRequest({ type: 'refund', reason: 'i_changed_my_mind' }) as any, PARAMS)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/invalid reason/i)
  })

  it('returns 404 when order is not found', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValue(null)

    const res = await POST(makeRequest(VALID_BODY) as any, PARAMS)
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error).toMatch(/not found/i)
  })

  it('returns 400 when order is not delivered', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ ...DELIVERED_ORDER, status: 'shipped' })

    const res = await POST(makeRequest(VALID_BODY) as any, PARAMS)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/delivered/i)
  })

  it('returns 400 when outside return window', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(DELIVERED_ORDER)
    vi.mocked(returnPolicy.checkReturnEligibility).mockResolvedValue({
      ok: false,
      reason: 'Return window has expired',
    } as any)

    const res = await POST(makeRequest(VALID_BODY) as any, PARAMS)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/window has expired/i)
  })

  it('returns 400 when a return request already exists', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(DELIVERED_ORDER)   // order
      .mockResolvedValueOnce({ id: 'rr-existing' }) // existing return request
    vi.mocked(returnPolicy.checkReturnEligibility).mockResolvedValue({ ok: true } as any)

    const res = await POST(makeRequest(VALID_BODY) as any, PARAMS)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/already exists/i)
  })

  it('returns 400 when monthly return limit is reached', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(DELIVERED_ORDER)    // order
      .mockResolvedValueOnce(null)               // no existing return request
      .mockResolvedValueOnce({ cnt: '1' })       // monthly count = 1 (limit reached)
    vi.mocked(returnPolicy.checkReturnEligibility).mockResolvedValue({ ok: true } as any)

    const res = await POST(makeRequest(VALID_BODY) as any, PARAMS)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/1 is allowed per month/i)
  })

  it('happy path: creates return request and returns 201', async () => {
    const RETURN_REQUEST = {
      id: 'rr-new',
      order_id: 'order-123',
      user_id: 'user-456',
      type: 'refund',
      reason: 'defective',
      status: 'pending',
    }

    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(DELIVERED_ORDER)    // order
      .mockResolvedValueOnce(null)               // no existing return request
      .mockResolvedValueOnce({ cnt: '0' })       // monthly count = 0
      .mockResolvedValueOnce(RETURN_REQUEST)     // inserted return request
    vi.mocked(db.queryMany).mockResolvedValue([]) // admins
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 } as any)
    vi.mocked(returnPolicy.checkReturnEligibility).mockResolvedValue({ ok: true } as any)

    const res = await POST(makeRequest(VALID_BODY) as any, PARAMS)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.returnRequest).toBeDefined()
    expect(body.returnRequest.type).toBe('refund')
  })
})
