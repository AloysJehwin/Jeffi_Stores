import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))

vi.mock('@/lib/queries', () => ({
  getProduct: vi.fn(),
}))

vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/validate', () => ({
  parseBody: vi.fn(),
  zNonEmpty: { optional: vi.fn() },
  zCurrency: { optional: vi.fn() },
  zUuid: { optional: vi.fn() },
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { GET, PATCH } from '@/app/api/admin/products/[id]/route'
import { authenticateAdmin } from '@/lib/jwt'
import { query } from '@/lib/db'
import { getProduct } from '@/lib/queries'
import { hasScope } from '@/lib/scopes'
import { parseBody } from '@/lib/validate'

const mockAuth = vi.mocked(authenticateAdmin)
const mockGetProduct = vi.mocked(getProduct)
const mockHasScope = vi.mocked(hasScope)
const mockParseBody = vi.mocked(parseBody)
const mockQuery = vi.mocked(query)

// ── Helpers ───────────────────────────────────────────────────────────────────

const adminPayload = {
  adminId: 'admin-1',
  username: 'testadmin',
  role: 'super_admin',
  scopes: ['products'],
}

function makeGetRequest(id: string, cookies: Record<string, string> = {}) {
  const cookieHeader = Object.entries({ admin_sid: 'valid-token', ...cookies })
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
  return new NextRequest(`http://localhost/api/admin/products/${id}`, {
    method: 'GET',
    headers: { cookie: cookieHeader },
  })
}

function makePatchRequest(id: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/admin/products/${id}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      cookie: 'admin_sid=valid-token',
    },
    body: JSON.stringify(body),
  })
}

const sampleProduct = {
  id: 'prod-1',
  name: 'Test Product',
  sku: 'SKU-001',
  base_price: 100,
  category_id: 'cat-1',
  variants: [],
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/products/[id]', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const req = makeGetRequest('prod-1')
    const res = await GET(req, { params: Promise.resolve({ id: 'prod-1' }) })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 403 when scope is insufficient', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(false)
    const req = makeGetRequest('prod-1')
    const res = await GET(req, { params: Promise.resolve({ id: 'prod-1' }) })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/insufficient/i)
  })

  it('returns 404 when product not found', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockGetProduct.mockRejectedValue(new Error('Product not found'))
    const req = makeGetRequest('prod-999')
    const res = await GET(req, { params: Promise.resolve({ id: 'prod-999' }) })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/not found/i)
  })

  it('returns product with variants on success', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockGetProduct.mockResolvedValue(sampleProduct)
    const req = makeGetRequest('prod-1')
    const res = await GET(req, { params: Promise.resolve({ id: 'prod-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('prod-1')
    expect(body.name).toBe('Test Product')
  })

  it('returns 500 on unexpected error', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockGetProduct.mockRejectedValue(new Error('DB connection lost'))
    const req = makeGetRequest('prod-1')
    const res = await GET(req, { params: Promise.resolve({ id: 'prod-1' }) })
    expect(res.status).toBe(500)
  })
})

describe('PATCH /api/admin/products/[id]', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const req = makePatchRequest('prod-1', { category_id: 'cat-1' })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'prod-1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope is insufficient', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(false)
    const req = makePatchRequest('prod-1', { category_id: 'cat-1' })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'prod-1' }) })
    expect(res.status).toBe(403)
  })

  it('returns 400 when category_id is missing', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    // parseBody passes (returns ok: true) but no category_id in body
    mockParseBody.mockReturnValue({ ok: true } as any)
    const req = makePatchRequest('prod-1', { name: 'Updated' })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'prod-1' }) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/category_id/i)
  })

  it('updates product and returns ok on success', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true } as any)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

    const req = makePatchRequest('prod-1', { category_id: 'cat-2' })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'prod-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE products'),
      expect.arrayContaining(['cat-2', expect.any(String), 'prod-1'])
    )
  })

  it('returns validation error response when parseBody fails', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const errorResponse = new Response(JSON.stringify({ error: 'Validation failed' }), { status: 422 })
    mockParseBody.mockReturnValue({ ok: false, response: errorResponse } as any)

    const req = makePatchRequest('prod-1', {})
    const res = await PATCH(req, { params: Promise.resolve({ id: 'prod-1' }) })
    expect(res.status).toBe(422)
  })
})
