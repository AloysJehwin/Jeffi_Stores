import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({ queryOne: vi.fn() }))
vi.mock('@/lib/packing-slip-pdf', () => ({
  generatePackingSlipPDF: vi.fn(),
  loadStoreSettings: vi.fn(),
}))

import { GET } from '@/app/api/admin/packing-slips/[id]/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne } from '@/lib/db'
import { generatePackingSlipPDF, loadStoreSettings } from '@/lib/packing-slip-pdf'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockGeneratePDF = vi.mocked(generatePackingSlipPDF)
const mockLoadStore = vi.mocked(loadStoreSettings)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['packing_slips'] }
const params = Promise.resolve({ id: 'order-abc' })

function makeRequest(inline = false) {
  const url = `http://localhost/api/admin/packing-slips/order-abc${inline ? '?inline=1' : ''}`
  return new NextRequest(url)
}

const sampleOrder = {
  id: 'order-abc',
  order_number: 'ORD-001',
  created_at: '2024-01-01',
  customer_name: 'Alice',
  customer_phone: '9999999999',
  total_amount: 1000,
  discount_amount: 0,
  shipping_amount: 50,
  shipping_address: {},
  items: [],
}

const storeSettings = { name: 'Test Store', address: '123 Main St' }

describe('GET /api/admin/packing-slips/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeRequest(), { params })
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  it('returns 403 when scope is missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeRequest(), { params })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/insufficient/i)
  })

  it('returns 404 when order not found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)
    mockLoadStore.mockResolvedValue(storeSettings as any)

    const res = await GET(makeRequest(), { params })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/not found/i)
  })

  it('returns PDF as attachment by default', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(sampleOrder)
    mockLoadStore.mockResolvedValue(storeSettings as any)
    mockGeneratePDF.mockResolvedValue(Buffer.from('fake-pdf') as any)

    const res = await GET(makeRequest(), { params })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toMatch(/attachment/)
    expect(res.headers.get('Content-Disposition')).toMatch(/ORD-001/)
  })

  it('returns PDF as inline when inline=1', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(sampleOrder)
    mockLoadStore.mockResolvedValue(storeSettings as any)
    mockGeneratePDF.mockResolvedValue(Buffer.from('fake-pdf') as any)

    const res = await GET(makeRequest(true), { params })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Disposition')).toMatch(/inline/)
  })

  it('returns 500 when PDF generation fails', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(sampleOrder)
    mockLoadStore.mockResolvedValue(storeSettings as any)
    mockGeneratePDF.mockRejectedValue(new Error('PDF generation failed'))

    const res = await GET(makeRequest(), { params })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/PDF generation failed/)
  })
})
