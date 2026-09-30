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
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))

vi.mock('@/lib/quotation-pdf', () => ({
  generateQuotationPDF: vi.fn(),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { GET } from '@/app/api/admin/quotations/[id]/pdf/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany } from '@/lib/db'
import { generateQuotationPDF } from '@/lib/quotation-pdf'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)
const mockGeneratePDF = vi.mocked(generateQuotationPDF)

const adminPayload = {
  adminId: 'admin-1',
  username: 'testadmin',
  role: 'super_admin',
  scopes: ['quotations'],
}

function makeRequest(id = 'qt-1') {
  return new NextRequest(`http://localhost/api/admin/quotations/${id}/pdf`, {
    method: 'GET',
    headers: { cookie: 'admin_sid=valid-token' },
  })
}

const sampleQuotation = {
  id: 'qt-1',
  quote_number: 'QT/2024/001',
  customer_name: 'Test Co',
}

const sampleItems = [
  {
    description: 'Widget A',
    hsn_code: '8501',
    gst_rate: '18',
    quantity: '10',
    unit: 'pcs',
    rate: '100',
    discount_pct: '0',
    amount: '1000',
  },
]

const sampleSettings = [
  { key: 'business_gstin', value: '27AAAA0000A1Z5' },
  { key: 'business_legal_name', value: 'Test Legal Name' },
  { key: 'bank_name', value: 'Test Bank' },
]

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/quotations/[id]/pdf', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'qt-1' }) })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 403 when scope is insufficient', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'qt-1' }) })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/insufficient/i)
  })

  it('returns 404 when quotation not found', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'qt-999' }) })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/not found/i)
  })

  it('returns PDF buffer with correct headers on success', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(sampleQuotation)
    mockQueryMany.mockResolvedValueOnce(sampleItems).mockResolvedValueOnce(sampleSettings)
    const pdfBuffer = Buffer.from('%PDF-1.4 fake pdf content')
    mockGeneratePDF.mockResolvedValue(pdfBuffer)

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'qt-1' }) })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toContain('quotation-QT-2024-001.pdf')
  })

  it('passes business data from settings to PDF generator', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(sampleQuotation)
    mockQueryMany.mockResolvedValueOnce(sampleItems).mockResolvedValueOnce(sampleSettings)
    const pdfBuffer = Buffer.from('pdf')
    mockGeneratePDF.mockResolvedValue(pdfBuffer)

    await GET(makeRequest(), { params: Promise.resolve({ id: 'qt-1' }) })

    expect(mockGeneratePDF).toHaveBeenCalledWith(
      sampleQuotation,
      expect.any(Array),
      expect.objectContaining({ gstin: '27AAAA0000A1Z5' })
    )
  })

  it('handles empty items array gracefully', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(sampleQuotation)
    mockQueryMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    mockGeneratePDF.mockResolvedValue(Buffer.from('pdf'))

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'qt-1' }) })
    expect(res.status).toBe(200)
  })

  it('returns 500 when PDF generation throws', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(sampleQuotation)
    mockQueryMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    mockGeneratePDF.mockRejectedValue(new Error('PDF render failed'))

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'qt-1' }) })
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/PDF render failed/i)
  })
})
