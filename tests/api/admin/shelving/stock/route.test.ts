import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({ queryOne: vi.fn() }))
vi.mock('@/lib/shelf', () => ({
  getStockAtLocation: vi.fn(),
  getStockForProduct: vi.fn(),
  adjustStock: vi.fn(),
  moveStock: vi.fn(),
  getBatchesAtLocation: vi.fn(),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { GET, POST } from '@/app/api/admin/shelving/stock/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne } from '@/lib/db'
import { getStockAtLocation, getStockForProduct, adjustStock, moveStock, getBatchesAtLocation } from '@/lib/shelf'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockGetStockAtLocation = vi.mocked(getStockAtLocation)
const mockGetStockForProduct = vi.mocked(getStockForProduct)
const mockAdjustStock = vi.mocked(adjustStock)
const mockMoveStock = vi.mocked(moveStock)
const mockGetBatchesAtLocation = vi.mocked(getBatchesAtLocation)

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'admin-1', id: 'admin-1', role: 'super_admin', scopes: ['inventory'] }

function makeGetReq(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/shelving/stock')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  // Simulate nextUrl
  const req = new NextRequest(url.toString())
  return req
}

function makePostReq(body: unknown) {
  return new NextRequest('http://localhost/api/admin/shelving/stock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const stockAtLocation = [
  { location_id: 'loc-1', product_id: 'prod-1', quantity: 10 },
]

// ── GET ───────────────────────────────────────────────────────────────────────

describe('GET /api/admin/shelving/stock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockGetBatchesAtLocation.mockResolvedValue([] as any)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null as any)
    const res = await GET(makeGetReq())
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Unauthorized')
  })

  it('returns 403 when scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeGetReq())
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Forbidden')
  })

  it('returns 400 when neither location_id nor product_id provided', async () => {
    const res = await GET(makeGetReq())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('location_id or product_id required')
  })

  it('returns stock by product_id', async () => {
    mockGetStockForProduct.mockResolvedValueOnce(stockAtLocation as any)
    const res = await GET(makeGetReq({ product_id: 'prod-1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.locations).toEqual(stockAtLocation)
    expect(mockGetStockForProduct).toHaveBeenCalledWith('prod-1', null, null)
  })

  it('returns stock by location_id', async () => {
    mockGetStockAtLocation.mockResolvedValueOnce(stockAtLocation as any)
    const res = await GET(makeGetReq({ location_id: 'loc-1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.stock).toBeDefined()
    expect(mockGetStockAtLocation).toHaveBeenCalledWith('loc-1')
  })

  it('passes variant_id and sub_variant_id to getStockForProduct', async () => {
    mockGetStockForProduct.mockResolvedValueOnce([] as any)
    const res = await GET(makeGetReq({ product_id: 'prod-1', variant_id: 'var-1', sub_variant_id: 'sv-1' }))
    expect(res.status).toBe(200)
    expect(mockGetStockForProduct).toHaveBeenCalledWith('prod-1', 'var-1', 'sv-1')
  })

  it('returns 500 on error', async () => {
    mockGetStockAtLocation.mockRejectedValueOnce(new Error('shelf error'))
    const res = await GET(makeGetReq({ location_id: 'loc-1' }))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('shelf error')
  })
})

// ── POST ──────────────────────────────────────────────────────────────────────

describe('POST /api/admin/shelving/stock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null as any)
    const res = await POST(makePostReq({ action: 'adjust', location_id: 'loc-1', product_id: 'prod-1', quantity_change: 5 }))
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await POST(makePostReq({ action: 'adjust', location_id: 'loc-1', product_id: 'prod-1', quantity_change: 5 }))
    expect(res.status).toBe(403)
  })

  // Move action
  describe('action: move', () => {
    it('returns 400 when from_location_id missing', async () => {
      const res = await POST(makePostReq({ action: 'move', to_location_id: 'loc-2', product_id: 'prod-1', quantity: 5 }))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toContain('from_location_id')
    })

    it('returns 400 when quantity is zero or negative', async () => {
      const res = await POST(makePostReq({ action: 'move', from_location_id: 'loc-1', to_location_id: 'loc-2', product_id: 'prod-1', quantity: 0 }))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('quantity must be positive')
    })

    it('moves stock successfully using product_id directly', async () => {
      mockMoveStock.mockResolvedValueOnce(undefined as any)
      const res = await POST(makePostReq({
        action: 'move',
        from_location_id: 'loc-1',
        to_location_id: 'loc-2',
        product_id: 'prod-1',
        quantity: 3,
      }))
      expect(res.status).toBe(200)
      expect((await res.json()).ok).toBe(true)
      expect(mockMoveStock).toHaveBeenCalledWith('loc-1', 'loc-2', 'prod-1', null, null, 3, 'admin-1')
    })

    it('resolves product_id via variant_id when product_id absent', async () => {
      mockQueryOne.mockResolvedValueOnce({ product_id: 'resolved-prod-1' } as any)
      mockMoveStock.mockResolvedValueOnce(undefined as any)
      const res = await POST(makePostReq({
        action: 'move',
        from_location_id: 'loc-1',
        to_location_id: 'loc-2',
        variant_id: 'var-1',
        quantity: 2,
      }))
      expect(res.status).toBe(200)
      expect(mockMoveStock).toHaveBeenCalledWith('loc-1', 'loc-2', 'resolved-prod-1', 'var-1', null, 2, 'admin-1')
    })

    it('returns 500 when variant not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null) // variant not found
      const res = await POST(makePostReq({
        action: 'move',
        from_location_id: 'loc-1',
        to_location_id: 'loc-2',
        variant_id: 'nonexistent',
        quantity: 2,
      }))
      expect(res.status).toBe(500)
      expect((await res.json()).error).toBe('Variant not found')
    })
  })

  // Adjust action
  describe('action: adjust (default)', () => {
    it('returns 400 when location_id missing', async () => {
      const res = await POST(makePostReq({ product_id: 'prod-1', quantity_change: 5 }))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('location_id required')
    })

    it('returns 400 when quantity_change is not a number', async () => {
      const res = await POST(makePostReq({ location_id: 'loc-1', product_id: 'prod-1', quantity_change: 'abc' }))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('quantity_change must be a number')
    })

    it('adjusts stock successfully', async () => {
      const updatedStock = { quantity: 15 }
      mockQueryOne.mockResolvedValueOnce({ q: '100' } as any)
      mockQueryOne.mockResolvedValueOnce({ total: '0' } as any)
      mockAdjustStock.mockResolvedValueOnce(updatedStock as any)
      const res = await POST(makePostReq({ location_id: 'loc-1', product_id: 'prod-1', quantity_change: 5 }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.stock).toEqual(updatedStock)
      expect(mockAdjustStock).toHaveBeenCalledWith('loc-1', 'prod-1', null, null, 5, 'adjustment', 'admin-1')
    })

    it('adjusts with negative quantity_change (removal)', async () => {
      mockAdjustStock.mockResolvedValueOnce({ quantity: 5 } as any)
      const res = await POST(makePostReq({ location_id: 'loc-1', product_id: 'prod-1', quantity_change: -3, reason: 'sale' }))
      expect(res.status).toBe(200)
      expect(mockAdjustStock).toHaveBeenCalledWith('loc-1', 'prod-1', null, null, -3, 'sale', 'admin-1')
    })

    it('returns 409 on insufficient stock error', async () => {
      mockAdjustStock.mockRejectedValueOnce(new Error('Insufficient stock at location'))
      const res = await POST(makePostReq({ location_id: 'loc-1', product_id: 'prod-1', quantity_change: -100 }))
      expect(res.status).toBe(409)
      expect((await res.json()).error).toContain('Insufficient')
    })

    it('returns 500 on other errors', async () => {
      mockQueryOne.mockResolvedValueOnce({ q: '100' } as any)
      mockQueryOne.mockResolvedValueOnce({ total: '0' } as any)
      mockAdjustStock.mockRejectedValueOnce(new Error('Connection refused'))
      const res = await POST(makePostReq({ location_id: 'loc-1', product_id: 'prod-1', quantity_change: 5 }))
      expect(res.status).toBe(500)
    })
  })
})
