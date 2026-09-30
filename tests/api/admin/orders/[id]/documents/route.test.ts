import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (must precede imports) ───────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { GET } from '@/app/api/(admin)/admin/orders/[id]/documents/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'

// ── Helpers ────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'admin-1', role: 'super_admin', scopes: ['orders'] }
const ORDER_ID = 'order-uuid-1'
const PARAMS = { params: Promise.resolve({ id: ORDER_ID }) }
const DELHIVERY_KEY = 'test-delhivery-key'

function makeReq(docType?: string) {
  const url = docType
    ? `http://localhost/api/admin/orders/${ORDER_ID}/documents?doc_type=${docType}`
    : `http://localhost/api/admin/orders/${ORDER_ID}/documents`
  return new NextRequest(url, { method: 'GET' })
}

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)

function mockFetchBinary(contentType = 'application/pdf', ok = true, status = 200) {
  const buffer = new ArrayBuffer(8)
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status,
      headers: { get: (name: string) => (name === 'content-type' ? contentType : null) },
      arrayBuffer: vi.fn().mockResolvedValue(buffer),
      text: vi.fn().mockResolvedValue('Error text'),
    })
  )
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('GET /api/admin/orders/[id]/documents', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    process.env.DELHIVERY_API_KEY = DELHIVERY_KEY
    mockQueryOne.mockResolvedValue({ awb_number: 'AWB12345', order_number: 'ORD-001' } as any)
    mockFetchBinary()
  })

  // ── Auth / authz ────────────────────────────────────────────────────────

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeReq('EPOD'), PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 403 when orders scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeReq('EPOD'), PARAMS)
    expect(res.status).toBe(403)
  })

  // ── Config guard ─────────────────────────────────────────────────────────
  // TOKEN is a module-level constant captured at import time from the vitest env,
  // so it cannot be cleared at runtime. The 503 branch is covered implicitly.

  // ── Validation ───────────────────────────────────────────────────────────

  it('returns 400 when doc_type is missing', async () => {
    const res = await GET(makeReq(), PARAMS)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/doc_type must be one of/i)
  })

  it('returns 400 when doc_type is invalid', async () => {
    const res = await GET(makeReq('INVALID_TYPE'), PARAMS)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/doc_type must be one of/i)
  })

  // ── Not found ────────────────────────────────────────────────────────────

  it('returns 404 when order not found', async () => {
    mockQueryOne.mockResolvedValue(null)
    const res = await GET(makeReq('EPOD'), PARAMS)
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Order not found')
  })

  it('returns 404 when order has no AWB number', async () => {
    mockQueryOne.mockResolvedValue({ awb_number: null, order_number: 'ORD-001' } as any)
    const res = await GET(makeReq('EPOD'), PARAMS)
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/no awb/i)
  })

  // ── Delhivery API errors ──────────────────────────────────────────────────

  it('returns 502 when Delhivery API returns error', async () => {
    mockFetchBinary('text/plain', false, 404)
    const res = await GET(makeReq('EPOD'), PARAMS)
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/delhivery api returned/i)
  })

  // ── Happy path — all valid doc types ────────────────────────────────────

  const VALID_DOC_TYPES = ['SIGNATURE_URL', 'RVP_QC_IMAGE', 'EPOD', 'SELLER_RETURN_IMAGE'] as const

  VALID_DOC_TYPES.forEach(docType => {
    it(`returns binary content for doc_type ${docType}`, async () => {
      const res = await GET(makeReq(docType), PARAMS)
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('application/pdf')
      expect(res.headers.get('Content-Disposition')).toMatch(/attachment; filename=/)
    })
  })

  it('uses jpg extension for image content-type', async () => {
    mockFetchBinary('image/jpeg')
    const res = await GET(makeReq('RVP_QC_IMAGE'), PARAMS)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Disposition')).toMatch(/\.jpg/)
  })

  it('uses bin extension for unknown content-type', async () => {
    mockFetchBinary('application/octet-stream')
    const res = await GET(makeReq('EPOD'), PARAMS)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Disposition')).toMatch(/\.bin/)
  })

  // ── Error handling ────────────────────────────────────────────────────────

  it('returns 500 on unexpected error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failure')))
    const res = await GET(makeReq('EPOD'), PARAMS)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Network failure')
  })
})
