import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  queryMany: vi.fn(),
}))

vi.mock('@/lib/packing-slip-pdf', () => ({
  generateBulkPackingSlipPDF: vi.fn(),
  loadStoreSettings: vi.fn(),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/packing-slips/bulk/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany } from '@/lib/db'
import { generateBulkPackingSlipPDF, loadStoreSettings } from '@/lib/packing-slip-pdf'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryMany = vi.mocked(queryMany)
const mockGeneratePDF = vi.mocked(generateBulkPackingSlipPDF)
const mockLoadSettings = vi.mocked(loadStoreSettings)

const adminPayload = {
  adminId: 'admin-1',
  username: 'testadmin',
  role: 'super_admin',
  scopes: ['packing_slips'],
}

function makeRequest(body: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/admin/packing-slips/bulk', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'admin_token=valid' },
    body: JSON.stringify(body),
  })
}

const sampleOrders = [
  { id: 'order-1', order_number: 'ORD-001', customer_name: 'Alice', items: [] },
  { id: 'order-2', order_number: 'ORD-002', customer_name: 'Bob', items: [] },
]

const storeSettings = { name: 'Test Store', address: '123 Main St' }

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/packing-slips/bulk', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequest({ order_ids: ['id-1'] }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 403 when scope is insufficient', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeRequest({ order_ids: ['id-1'] }))
    expect(res.status).toBe(403)
  })

  it('returns 400 when order_ids is missing', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/order_ids required/i)
  })

  it('returns 400 when order_ids is empty array', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makeRequest({ order_ids: [] }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when more than 100 orders requested', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makeRequest({ order_ids: Array(101).fill('id') }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/maximum 100/i)
  })

  it('returns 404 when no orders found in DB', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])
    mockLoadSettings.mockResolvedValue(storeSettings as any)

    const res = await POST(makeRequest({ order_ids: ['order-999'] }))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/no orders found/i)
  })

  it('returns PDF buffer with correct headers on success', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue(sampleOrders)
    mockLoadSettings.mockResolvedValue(storeSettings as any)
    const pdfBuffer = Buffer.from('%PDF-1.4 packing slip content')
    mockGeneratePDF.mockResolvedValue(pdfBuffer)

    const res = await POST(makeRequest({ order_ids: ['order-1', 'order-2'] }))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toContain('packing-slips-')
  })

  it('returns 500 when PDF generation throws', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue(sampleOrders)
    mockLoadSettings.mockResolvedValue(storeSettings as any)
    mockGeneratePDF.mockRejectedValue(new Error('PDF failed'))

    const res = await POST(makeRequest({ order_ids: ['order-1'] }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/PDF failed/i)
  })
})
