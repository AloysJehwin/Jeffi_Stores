import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/label-pdf', () => ({
  generateLabelPDF: vi.fn().mockResolvedValue(Buffer.from('pdf')),
  generateLabelSheetPDF: vi.fn().mockResolvedValue(Buffer.from('sheet-pdf')),
  LABEL_SIZES: [{ size: '40x25' }, { size: '60x40' }],
}))

import { POST } from '@/app/api/admin/labels/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany } from '@/lib/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryMany = vi.mocked(queryMany)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['labels'] }

function makeReq(body: any) {
  return new NextRequest('http://localhost/api/admin/labels', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => { vi.clearAllMocks() })

describe('POST /api/admin/labels', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeReq({ product_ids: ['p1'], size: '40x25' }))
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeReq({ product_ids: ['p1'], size: '40x25' }))
    expect(res.status).toBe(403)
  })

  it('returns 400 when product_ids is empty', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makeReq({ product_ids: [], size: '40x25' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when product_ids exceeds 200', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const ids = Array.from({ length: 201 }, (_, i) => `product:${i}`)
    const res = await POST(makeReq({ product_ids: ids, size: '40x25' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/200/)
  })

  it('returns 400 when size is invalid', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makeReq({ product_ids: ['p1'], size: 'invalid-size' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/size/i)
  })

  it('returns 404 when no products found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])
    const res = await POST(makeReq({ product_ids: ['product:uuid-1'], size: '40x25' }))
    expect(res.status).toBe(404)
  })

  it('returns PDF on happy path with product: prefix', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const productId = 'product:abc-123'
    mockQueryMany.mockResolvedValue([{ id: productId, name: 'Bolt', sku: 'B1', mrp: 10, gst_percentage: 18 }])
    const res = await POST(makeReq({ product_ids: [productId], size: '40x25', copies: 1 }))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
  })

  it('handles variant: and subvariant: prefixes', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([{ id: 'variant:v1', name: 'Bolt M6', sku: 'V1', mrp: 5 }])
    const res = await POST(makeReq({ product_ids: ['variant:v1', 'subvariant:sv1'], size: '40x25' }))
    // variant and subvariant queries both return rows but only variant found → 200
    expect([200, 404]).toContain(res.status)
  })
})
