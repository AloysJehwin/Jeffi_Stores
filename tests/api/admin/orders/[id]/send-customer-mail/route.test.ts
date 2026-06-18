import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (must precede imports) ───────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))
vi.mock('@/lib/email', () => ({
  sendAdminContactEmail: vi.fn(),
}))
vi.mock('@/lib/validate', () => ({
  parseBody: vi.fn(),
  zNonEmpty: { _def: {} },
}))
vi.mock('@/lib/template-vars', () => ({
  buildVarMap: vi.fn().mockReturnValue({}),
  substituteVars: vi.fn().mockImplementation((s: string) => s),
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/orders/[id]/send-customer-mail/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne } from '@/lib/db'
import { sendAdminContactEmail } from '@/lib/email'
import { parseBody } from '@/lib/validate'
import { buildVarMap, substituteVars } from '@/lib/template-vars'

// ── Helpers ────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'admin-1', role: 'super_admin', scopes: ['orders'] }
const ORDER_ID = 'order-uuid-1'
const PARAMS = { params: { id: ORDER_ID } }

function makeReq(body: object) {
  return new NextRequest(`http://localhost/api/admin/orders/${ORDER_ID}/send-customer-mail`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockSendEmail = vi.mocked(sendAdminContactEmail)
const mockParseBody = vi.mocked(parseBody)

const ORDER = {
  id: ORDER_ID,
  order_number: 'ORD-001',
  customer_name: 'Alice Smith',
  customer_email: 'alice@example.com',
  users: { email: 'alice@example.com', first_name: 'Alice', last_name: 'Smith' },
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('POST /api/admin/orders/[id]/send-customer-mail', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({
      ok: true,
      data: { subject: 'Your Order Update', body: 'Hello {{firstName}}', isHtml: false },
    } as any)
    mockQueryOne.mockResolvedValue(ORDER as any)
    mockSendEmail.mockResolvedValue({ success: true } as any)
    vi.mocked(substituteVars).mockImplementation((s: string) => s)
    vi.mocked(buildVarMap).mockReturnValue({})
  })

  // ── Auth / authz ────────────────────────────────────────────────────────

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeReq({ subject: 'Hi', body: 'Hello' }), PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 403 when orders scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeReq({ subject: 'Hi', body: 'Hello' }), PARAMS)
    expect(res.status).toBe(403)
  })

  // ── Request body validation ───────────────────────────────────────────────

  it('returns 400 when request body is invalid JSON', async () => {
    const req = new NextRequest(`http://localhost/api/admin/orders/${ORDER_ID}/send-customer-mail`, {
      method: 'POST',
      body: 'not-json',
    })
    const res = await POST(req, PARAMS)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/invalid json/i)
  })

  it('returns schema validation error when parseBody fails', async () => {
    mockParseBody.mockReturnValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'subject is required' }), { status: 422 }),
    } as any)
    const res = await POST(makeReq({ body: 'Hello' }), PARAMS)
    expect(res.status).toBe(422)
  })

  // ── Order not found ───────────────────────────────────────────────────────

  it('returns 404 when order not found', async () => {
    mockQueryOne.mockResolvedValue(null)
    const res = await POST(makeReq({ subject: 'Hi', body: 'Hello' }), PARAMS)
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Order not found')
  })

  // ── No email guard ────────────────────────────────────────────────────────

  it('returns 400 when order has no customer email', async () => {
    mockQueryOne.mockResolvedValue({
      ...ORDER,
      customer_email: null,
      users: { email: '', first_name: 'Alice', last_name: 'Smith' },
    } as any)
    const res = await POST(makeReq({ subject: 'Hi', body: 'Hello' }), PARAMS)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/no customer email/i)
  })

  // ── Happy path ───────────────────────────────────────────────────────────

  it('sends email and returns success', async () => {
    const res = await POST(makeReq({ subject: 'Order Update', body: 'Hello Alice' }), PARAMS)
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(mockSendEmail).toHaveBeenCalledOnce()
  })

  it('uses customer_email fallback when users.email is missing', async () => {
    mockQueryOne.mockResolvedValue({
      ...ORDER,
      customer_email: 'fallback@example.com',
      users: { email: '', first_name: '', last_name: '' },
    } as any)
    const res = await POST(makeReq({ subject: 'Hi', body: 'Hello' }), PARAMS)
    expect(res.status).toBe(200)
    expect(mockSendEmail).toHaveBeenCalledWith(
      'fallback@example.com',
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(Object)
    )
  })

  // ── Email send failure ────────────────────────────────────────────────────

  it('returns 500 when email sending fails', async () => {
    mockSendEmail.mockResolvedValue({ success: false } as any)
    const res = await POST(makeReq({ subject: 'Hi', body: 'Hello' }), PARAMS)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/failed to send email/i)
  })
})
