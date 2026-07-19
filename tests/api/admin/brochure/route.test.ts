import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/queries', () => ({
  getBrochureProductsByIds: vi.fn(),
}))

vi.mock('@/lib/brochure-pdf', () => ({
  generateBrochurePDF: vi.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
  loadBrochureStore: vi.fn().mockResolvedValue({
    name: 'JEFFI STORES', address: '', city: '', phone: '', email: '', gstin: '', web: 'jeffistores.in',
  }),
}))

import { POST } from '@/app/api/admin/brochure/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { getBrochureProductsByIds } from '@/lib/queries'
import { generateBrochurePDF } from '@/lib/brochure-pdf'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockGetByIds = vi.mocked(getBrochureProductsByIds)
const mockGeneratePDF = vi.mocked(generateBrochurePDF)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['products'] }

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'

function makeReq(body: any) {
  return new NextRequest('http://localhost/api/admin/brochure', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => { vi.clearAllMocks() })

describe('POST /api/admin/brochure', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeReq({ productIds: [P1], showPrices: true }))
    expect(res.status).toBe(401)
  })

  it('returns 403 when products:read scope missing', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeReq({ productIds: [P1], showPrices: true }))
    expect(res.status).toBe(403)
  })

  it('returns 400 when productIds is empty', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makeReq({ productIds: [], showPrices: true }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/product/i)
  })

  it('returns 400 when ids are not valid UUIDs', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makeReq({ productIds: ['not-a-uuid'], showPrices: true }))
    expect(res.status).toBe(400)
  })

  it('returns 404 when no matching products found', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockGetByIds.mockResolvedValue([])
    const res = await POST(makeReq({ productIds: [P1], showPrices: true }))
    expect(res.status).toBe(404)
  })

  it('returns a PDF on the happy path', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockGetByIds.mockResolvedValue([
      { id: P1, name: 'Bolt', slug: 'bolt', sku: 'B1', short_description: null, mrp: 10, base_price: 8, discount_pct: 0, brand_name: 'Unbrako', category_name: 'Bolts', thumbnail_url: null },
    ] as any)
    const res = await POST(makeReq({ productIds: [P1, P2], showPrices: true, title: 'My Brochure' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(mockGetByIds).toHaveBeenCalledWith([P1, P2])
    expect(mockGeneratePDF).toHaveBeenCalled()
  })
})
