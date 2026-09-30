import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))

vi.mock('@/lib/auth/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/shared/validate', () => ({
  parseBody: vi.fn(),
  zNonEmpty: { optional: vi.fn() },
}))

vi.mock('@/lib/shared/mail-audit', () => ({
  sendAuditedMail: vi.fn().mockResolvedValue({ messageId: 'msg-1' }),
}))

vi.mock('@/lib/payments/razorpay', () => ({
  isRazorpayEnabled: vi.fn().mockReturnValue(false),
  getRazorpayInstance: vi.fn(),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { GET, PATCH } from '@/app/api/admin/orders/[id]/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { queryOne, queryMany } from '@/lib/shared/db'
import { hasScope } from '@/lib/auth/scopes'
import { parseBody } from '@/lib/shared/validate'
import { sendAuditedMail } from '@/lib/shared/mail-audit'

const mockAuth = vi.mocked(authenticateAdmin)
const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)
const mockHasScope = vi.mocked(hasScope)
const mockParseBody = vi.mocked(parseBody)
const mockSendAuditedMail = vi.mocked(sendAuditedMail)

// ── Helpers ───────────────────────────────────────────────────────────────────

const adminPayload = {
  adminId: 'admin-1',
  username: 'testadmin',
  role: 'super_admin',
  scopes: ['orders'],
}

function makeRequest(method: string, id: string, body?: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/admin/orders/${id}`, {
    method,
    headers: {
      cookie: 'admin_sid=valid-token',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
}

const sampleOrder = {
  id: 'order-1',
  order_number: 'ORD-001',
  status: 'pending',
  total_amount: 500,
  customer_name: 'John Doe',
  shipping_address: null,
}

const sampleItems = [{ id: 'item-1', product_name: 'Widget', quantity: 2, unit_price: 250 }]

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/orders/[id]', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const req = makeRequest('GET', 'order-1')
    const res = await GET(req, { params: Promise.resolve({ id: 'order-1' }) })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 403 when scope is insufficient', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(false)
    const req = makeRequest('GET', 'order-1')
    const res = await GET(req, { params: Promise.resolve({ id: 'order-1' }) })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/insufficient/i)
  })

  it('returns 404 when order not found', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)
    const req = makeRequest('GET', 'order-999')
    const res = await GET(req, { params: Promise.resolve({ id: 'order-999' }) })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/not found/i)
  })

  it('returns order with items on success', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(sampleOrder)
    mockQueryMany.mockResolvedValue(sampleItems)

    const req = makeRequest('GET', 'order-1')
    const res = await GET(req, { params: Promise.resolve({ id: 'order-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.order.id).toBe('order-1')
    expect(body.items).toHaveLength(1)
    expect(body.items[0].product_name).toBe('Widget')
  })

  it('returns empty items array when no items found', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(sampleOrder)
    mockQueryMany.mockResolvedValue([])

    const req = makeRequest('GET', 'order-1')
    const res = await GET(req, { params: Promise.resolve({ id: 'order-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toEqual([])
  })
})

describe('PATCH /api/admin/orders/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockSendAuditedMail.mockResolvedValue({ messageId: 'msg-1' } as any)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const req = makeRequest('PATCH', 'order-1', { status: 'shipped' })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'order-1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope is insufficient', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(false)
    const req = makeRequest('PATCH', 'order-1', { status: 'shipped' })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'order-1' }) })
    expect(res.status).toBe(403)
  })

  it('returns validation error when body is invalid', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const errorResponse = new Response(JSON.stringify({ error: 'At least one field is required' }), { status: 422 })
    mockParseBody.mockReturnValue({ ok: false, response: errorResponse } as any)

    const req = makeRequest('PATCH', 'order-1', {})
    const res = await PATCH(req, { params: Promise.resolve({ id: 'order-1' }) })
    expect(res.status).toBe(422)
  })

  it('returns ok on valid status update', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: { status: 'shipped' } } as any)
    mockQueryOne.mockResolvedValue(null)

    const req = makeRequest('PATCH', 'order-1', { status: 'shipped' })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'order-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('returns ok on awb_number update', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: { awb_number: 'AWB123456' } } as any)
    mockQueryOne.mockResolvedValue(null)

    const req = makeRequest('PATCH', 'order-1', { awb_number: 'AWB123456' })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'order-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('returns ok on notes update', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: { notes: 'Handle with care' } } as any)
    mockQueryOne.mockResolvedValue(null)

    const req = makeRequest('PATCH', 'order-1', { notes: 'Handle with care' })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'order-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('returns 400 when updating EDD on a delivered order', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: { estimated_delivery_date: '2025-12-31' } } as any)
    mockQueryOne.mockResolvedValueOnce({ status: 'delivered' })

    const req = makeRequest('PATCH', 'order-1', { estimated_delivery_date: '2025-12-31' })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'order-1' }) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/delivered/i)
  })

  it('returns ok on EDD update for non-delivered order, sends email when order has email', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: { estimated_delivery_date: '2025-12-31' } } as any)
    // 1st queryOne: EDD guard — non-delivered status
    // 2nd queryOne: UPDATE
    // 3rd queryOne: order lookup for email
    mockQueryOne.mockResolvedValueOnce({ status: 'processing' }).mockResolvedValueOnce(null).mockResolvedValueOnce({
      order_number: 'ORD-001',
      id: 'order-1',
      email: 'customer@example.com',
      first_name: 'John',
    })

    const req = makeRequest('PATCH', 'order-1', { estimated_delivery_date: '2025-12-31' })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'order-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('returns ok on EDD update when order has no email (skips mail)', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: { estimated_delivery_date: '2025-12-31' } } as any)
    mockQueryOne
      .mockResolvedValueOnce({ status: 'processing' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ order_number: 'ORD-001', id: 'order-1', email: null, first_name: null })

    const req = makeRequest('PATCH', 'order-1', { estimated_delivery_date: '2025-12-31' })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'order-1' }) })
    expect(res.status).toBe(200)
  })

  it('returns ok on EDD update when EDD guard returns null (no current row)', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: { estimated_delivery_date: '2025-12-31' } } as any)
    mockQueryOne
      .mockResolvedValueOnce(null) // EDD guard — order not found, non-delivered
      .mockResolvedValueOnce(null) // UPDATE
      .mockResolvedValueOnce(null) // order lookup for email — null

    const req = makeRequest('PATCH', 'order-1', { estimated_delivery_date: '2025-12-31' })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'order-1' }) })
    expect(res.status).toBe(200)
  })
})
