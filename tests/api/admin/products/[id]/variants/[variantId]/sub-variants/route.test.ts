import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))
vi.mock('@/lib/catalog/sku', () => ({ generateVariantSku: vi.fn().mockReturnValue('PRD-RED') }))
vi.mock('@/lib/shared/validate', () => {
  const { z } = require('zod')
  return {
    zNonEmpty: z.string().min(1),
    zCurrency: z.coerce.number().min(0),
    zUuid: z.string().uuid(),
    // Plain function — NOT vi.fn() — so vi.clearAllMocks() cannot wipe the implementation
    parseBody: (schema: any, data: any) => {
      const result = schema.safeParse(data)
      if (result.success) return { ok: true, data: result.data }
      return {
        ok: false,
        response: Response.json({ error: result.error.issues[0]?.message ?? 'Validation error' }, { status: 400 }),
      }
    },
  }
})

// ── Imports ───────────────────────────────────────────────────────────────────

import { GET, POST, PUT, DELETE } from '@/app/api/(admin)/admin/products/[id]/variants/[variantId]/sub-variants/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query, queryOne, queryMany } from '@/lib/shared/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQuery = vi.mocked(query)
const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)

// ── Helpers ───────────────────────────────────────────────────────────────────

const PROD_ID = '6b19a420-b19c-4d7c-8b22-93bcbc2fc2cd'
const VAR_ID = 'b49444be-0c82-4710-a891-49eb8c3166bf'
const SV_ID = 'be35ce54-870f-4167-9e05-c7c3c863ac9d'

const ADMIN = { adminId: 'admin-1', role: 'super_admin', scopes: ['products'] }
const PARAMS = { params: Promise.resolve({ id: PROD_ID, variantId: VAR_ID }) }

function makeReq(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/admin/products/prod-1/variants/var-1/sub-variants', {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
}

const sampleSubVariant = {
  id: SV_ID,
  variant_id: VAR_ID,
  sku: 'PRD-RED',
  sub_variant_name: 'Red',
  price: 100,
  mrp: 120,
  stock_status: 'In Stock',
}

// ── GET ───────────────────────────────────────────────────────────────────────

describe('GET /api/admin/products/[id]/variants/[variantId]/sub-variants', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null as any)
    const res = await GET(makeReq('GET'), PARAMS)
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Unauthorized')
  })

  it('returns 403 when scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeReq('GET'), PARAMS)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Insufficient permissions')
  })

  it('returns list of sub-variants', async () => {
    mockQueryMany.mockResolvedValueOnce([sampleSubVariant] as any)
    const res = await GET(makeReq('GET'), PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sub_variants).toHaveLength(1)
    expect(body.sub_variants[0].sku).toBe('PRD-RED')
  })

  it('returns empty array when none exist', async () => {
    mockQueryMany.mockResolvedValueOnce([] as any)
    const res = await GET(makeReq('GET'), PARAMS)
    expect(res.status).toBe(200)
    expect((await res.json()).sub_variants).toEqual([])
  })
})

// ── POST ──────────────────────────────────────────────────────────────────────

describe('POST /api/admin/products/[id]/variants/[variantId]/sub-variants', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null as any)
    const res = await POST(makeReq('POST', { sub_variant_name: 'Red' }), PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeReq('POST', { sub_variant_name: 'Red' }), PARAMS)
    expect(res.status).toBe(403)
  })

  it('returns 404 when variant not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await POST(makeReq('POST', { sub_variant_name: 'Red' }), PARAMS)
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Variant not found')
  })

  it('returns 400 when body is invalid JSON', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'var-1', sku: 'PRD' } as any)
    const req = new NextRequest('http://localhost/test', {
      method: 'POST',
      body: 'not-json',
    })
    const res = await POST(req, PARAMS)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid JSON')
  })

  it('returns 400 when required fields missing', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'var-1', sku: 'PRD' } as any)
    const res = await POST(makeReq('POST', {}), PARAMS)
    expect(res.status).toBe(400)
  })

  it('creates sub-variant successfully', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'var-1', sku: 'PRD' } as any) // variant check
      .mockResolvedValueOnce({ sku: 'PRD' } as any) // product sku
      .mockResolvedValueOnce(sampleSubVariant as any) // insert returning
    const res = await POST(
      makeReq('POST', { sub_variant_name: 'Red', price: 100, mrp: 120, stock_status: 'In Stock' }),
      PARAMS
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.sub_variant.sku).toBe('PRD-RED')
  })

  it('uses provided sku instead of generated one', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'var-1', sku: 'PRD' } as any)
      .mockResolvedValueOnce({ sku: 'PRD' } as any)
      .mockResolvedValueOnce({ ...sampleSubVariant, sku: 'CUSTOM-SKU' } as any)
    const res = await POST(makeReq('POST', { sub_variant_name: 'Red', sku: 'CUSTOM-SKU' }), PARAMS)
    expect(res.status).toBe(201)
  })
})

// ── PUT ───────────────────────────────────────────────────────────────────────

describe('PUT /api/admin/products/[id]/variants/[variantId]/sub-variants', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null as any)
    const res = await PUT(makeReq('PUT', { id: SV_ID }), PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 404 when sub-variant not found', async () => {
    // sub_variant_name present → sku gen attempted, variant lookup returns null
    // then update returning also returns null → 404
    mockQueryOne
      .mockResolvedValueOnce({ sku: 'PRD' } as any) // variant sku found
      .mockResolvedValueOnce(null) // update returning → not found
    const res = await PUT(makeReq('PUT', { id: SV_ID, sub_variant_name: 'Blue' }), PARAMS)
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Not found')
  })

  it('updates sub-variant successfully', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ sku: 'PRD' } as any) // variant sku
      .mockResolvedValueOnce(sampleSubVariant as any) // update returning
    const res = await PUT(makeReq('PUT', { id: SV_ID, sub_variant_name: 'Red', price: 110 }), PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sub_variant).toBeDefined()
  })

  it('updates is_active flag', async () => {
    // no sub_variant_name → sku gen skipped → only one queryOne for update
    mockQueryOne.mockResolvedValueOnce(sampleSubVariant as any)
    const res = await PUT(makeReq('PUT', { id: SV_ID, is_active: false }), PARAMS)
    expect(res.status).toBe(200)
  })

  it('returns 400 for invalid body', async () => {
    const req = new NextRequest('http://localhost/test', { method: 'PUT', body: 'bad' })
    const res = await PUT(req, PARAMS)
    expect(res.status).toBe(400)
  })
})

// ── DELETE ────────────────────────────────────────────────────────────────────

describe('DELETE /api/admin/products/[id]/variants/[variantId]/sub-variants', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rows: [] } as any)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null as any)
    const res = await DELETE(makeReq('DELETE', { id: SV_ID }), PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await DELETE(makeReq('DELETE', { id: SV_ID }), PARAMS)
    expect(res.status).toBe(403)
  })

  it('returns 400 for invalid body', async () => {
    const req = new NextRequest('http://localhost/test', { method: 'DELETE', body: 'bad' })
    const res = await DELETE(req, PARAMS)
    expect(res.status).toBe(400)
  })

  it('returns 400 when id is not a valid UUID', async () => {
    const res = await DELETE(makeReq('DELETE', { id: 'not-a-uuid' }), PARAMS)
    expect(res.status).toBe(400)
  })

  it('deletes sub-variant successfully', async () => {
    const res = await DELETE(makeReq('DELETE', { id: SV_ID }), PARAMS)
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM product_sub_variants'),
      expect.arrayContaining([SV_ID])
    )
  })
})
