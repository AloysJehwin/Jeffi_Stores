import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/auth/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/shared/db', () => ({
  queryOne: vi.fn(),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { GET } from '@/app/api/admin/products/by-sku/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)

const adminPayload = {
  adminId: 'admin-1',
  username: 'testadmin',
  role: 'super_admin',
  scopes: ['products'],
}

function makeRequest(sku?: string) {
  const url = new URL('http://localhost/api/admin/products/by-sku')
  if (sku !== undefined) url.searchParams.set('q', sku)
  return new NextRequest(url.toString(), {
    method: 'GET',
    headers: { cookie: 'admin_sid=valid' },
  })
}

const sampleProduct = {
  id: 'prod-1',
  product_id: 'prod-1',
  variant_id: null,
  name: 'Widget A',
  variant_name: null,
  sku: 'WGT-001',
  slug: 'widget-a',
  mrp: 200,
  is_active: true,
}

const sampleVariant = {
  id: 'var-1',
  product_id: 'prod-1',
  variant_id: 'var-1',
  name: 'Widget A',
  variant_name: 'Red',
  sku: 'WGT-001-RED',
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/products/by-sku', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeRequest('WGT-001'))
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope is insufficient', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeRequest('WGT-001'))
    expect(res.status).toBe(403)
  })

  it('returns 400 when q param is missing', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const res = await GET(makeRequest())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/q required/i)
  })

  it('returns 400 when q param is empty string', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const res = await GET(makeRequest('  '))
    expect(res.status).toBe(400)
  })

  it('returns product type when SKU matches a product', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(sampleProduct) // product query

    const res = await GET(makeRequest('WGT-001'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.type).toBe('product')
    expect(body.item.sku).toBe('WGT-001')
  })

  it('falls through to variant lookup when product not found', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce(null) // product not found
      .mockResolvedValueOnce(sampleVariant) // variant found

    const res = await GET(makeRequest('WGT-001-RED'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.type).toBe('variant')
    expect(body.item.sku).toBe('WGT-001-RED')
  })

  it('returns 404 when neither product nor variant found', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce(null) // no product
      .mockResolvedValueOnce(null) // no variant

    const res = await GET(makeRequest('NONEXISTENT'))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/not found/i)
  })

  it('returns 500 on DB error', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockRejectedValue(new Error('DB connection failed'))

    const res = await GET(makeRequest('WGT-001'))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/DB connection failed/i)
  })
})
