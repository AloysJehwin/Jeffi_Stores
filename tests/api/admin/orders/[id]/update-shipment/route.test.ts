import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (must be before imports) ───────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({ queryOne: vi.fn(), query: vi.fn(), queryMany: vi.fn() }))
vi.mock('@/lib/validate', () => ({
  parseBody: vi.fn(),
  zNonEmpty: 'zNonEmpty',
}))

// Mock global fetch used to call Delhivery external API
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// ── Imports ───────────────────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/orders/[id]/update-shipment/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne } from '@/lib/db'
import { parseBody } from '@/lib/validate'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockParseBody = vi.mocked(parseBody)

// ── Helpers ───────────────────────────────────────────────────────────────────

const admin = { adminId: 'admin-1', username: 'testadmin', role: 'super_admin', scopes: ['orders'] }

function makeRequest(id: string, body?: unknown) {
  return new NextRequest(`http://localhost/api/admin/orders/${id}/update-shipment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

// NOTE: TOKEN = process.env.DELHIVERY_API_KEY is captured as a module-level const
// at import time. The vitest environment has DELHIVERY_API_KEY set (via vitest.config.ts
// or beforeEach below), so TOKEN is truthy and the 503 branch is NOT reachable in tests.
// We test all other branches instead.

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/orders/[id]/update-shipment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.DELHIVERY_API_KEY = 'test-delhivery-key'
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequest('ord-1', { name: 'Test' }), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  it('returns 403 when scope is missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeRequest('ord-1', { name: 'Test' }), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/insufficient/i)
  })

  it('returns 404 when order is not found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)

    const res = await POST(makeRequest('ord-999', { name: 'Test' }), { params: Promise.resolve({ id: 'ord-999' }) })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/not found/i)
  })

  it('returns 404 when order has no AWB number', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ awb_number: null })

    const res = await POST(makeRequest('ord-1', { name: 'Test' }), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/awb/i)
  })

  it('returns 400 when request body is invalid JSON', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ awb_number: 'AWB123456' })

    const req = new NextRequest('http://localhost/api/admin/orders/ord-1/update-shipment', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'NOT JSON',
    })
    const res = await POST(req, { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/invalid json/i)
  })

  it('returns parseBody error when validation fails', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ awb_number: 'AWB123456' })
    const errResp = new Response(JSON.stringify({ error: 'Validation failed' }), { status: 422 })
    mockParseBody.mockReturnValue({ ok: false, response: errResp } as any)

    const res = await POST(makeRequest('ord-1', {}), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(422)
  })

  it('calls Delhivery API and returns success on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ awb_number: 'AWB123456' })
    mockParseBody.mockReturnValue({
      ok: true,
      data: {
        name: 'John Doe',
        phone: '9876543210',
        add: null,
        products_desc: null,
        gm: null,
        shipment_height: null,
        shipment_width: null,
        shipment_length: null,
      },
    } as any)
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ updated: true }),
    })

    const res = await POST(makeRequest('ord-1', { name: 'John Doe' }), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('delhivery'),
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('returns 502 when Delhivery API responds with error', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ awb_number: 'AWB123456' })
    mockParseBody.mockReturnValue({
      ok: true,
      data: {
        name: 'Test',
        phone: null,
        add: null,
        products_desc: null,
        gm: null,
        shipment_height: null,
        shipment_width: null,
        shipment_length: null,
      },
    } as any)
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ message: 'Bad request' }),
    })

    const res = await POST(makeRequest('ord-1', { name: 'Test' }), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/delhivery/i)
  })

  it('returns 500 on unexpected error', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockRejectedValue(new Error('connection refused'))

    const res = await POST(makeRequest('ord-1', { name: 'Test' }), { params: Promise.resolve({ id: 'ord-1' }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/connection refused/i)
  })

  it('passes AWB number in Delhivery payload', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ awb_number: 'DL-789-XYZ' })
    mockParseBody.mockReturnValue({
      ok: true,
      data: {
        name: 'Jane',
        phone: null,
        add: null,
        products_desc: null,
        gm: null,
        shipment_height: null,
        shipment_width: null,
        shipment_length: null,
      },
    } as any)
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    })

    await POST(makeRequest('ord-1', { name: 'Jane' }), { params: Promise.resolve({ id: 'ord-1' }) })
    const fetchCall = mockFetch.mock.calls[0]
    const payload = JSON.parse(fetchCall[1].body as string)
    expect(payload.waybill).toBe('DL-789-XYZ')
    expect(payload.name).toBe('Jane')
  })
})
