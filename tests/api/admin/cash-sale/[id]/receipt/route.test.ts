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
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))

vi.mock('@/lib/receipt-pdf', () => ({
  generateReceiptPDF: vi.fn(),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { GET } from '@/app/api/admin/cash-sale/[id]/receipt/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany } from '@/lib/db'
import { generateReceiptPDF } from '@/lib/receipt-pdf'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)
const mockGeneratePDF = vi.mocked(generateReceiptPDF)

// ── Helpers ───────────────────────────────────────────────────────────────────

const adminPayload = {
  adminId: 'admin-1',
  username: 'testadmin',
  role: 'admin',
  scopes: ['invoices'],
}

const SALE_ID = 'sale-uuid-1'

function makeRequest(id: string) {
  return new NextRequest(`http://localhost/api/admin/cash-sale/${id}/receipt`, {
    method: 'GET',
    headers: { cookie: 'admin_sid=valid-token' },
  })
}

const sampleSale = {
  id: SALE_ID,
  invoice_number: 'INV-2026-001',
  sale_number: 'SALE-001',
  invoice_date: '2026-06-18',
  payment_mode: 'cash',
  customer_name: 'Walk-in Customer',
  notes: '',
  taxable_amount: '847.46',
  cgst_amount: '76.27',
  sgst_amount: '76.27',
  igst_amount: '0',
  is_igst: false,
  total_amount: '1000.00',
}

const sampleItems = [
  {
    product_name: 'Widget A',
    variant_name: 'Red',
    quantity: '2',
    unit_price: '423.73',
    total_price: '847.46',
    taxable_amount: '847.46',
    cgst_amount: '76.27',
    sgst_amount: '76.27',
    igst_amount: '0',
    gst_rate: '18',
  },
]

const sampleSettings = [
  { key: 'business_gstin', value: '29ABCDE1234F1Z5' },
  { key: 'business_legal_name', value: 'Test Store Pvt Ltd' },
  { key: 'business_trade_name', value: 'Test Store' },
  { key: 'business_address', value: '123 Main St, Bangalore' },
  { key: 'business_phone', value: '9876543210' },
]

const fakePdfBuffer = Buffer.from('fake-receipt-pdf')

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/cash-sale/[id]/receipt', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeRequest(SALE_ID), { params: Promise.resolve({ id: SALE_ID }) })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 403 when invoices scope is missing', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeRequest(SALE_ID), { params: Promise.resolve({ id: SALE_ID }) })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/insufficient/i)
  })

  it('returns 404 when sale not found', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)
    const res = await GET(makeRequest(SALE_ID), { params: Promise.resolve({ id: SALE_ID }) })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/sale not found/i)
  })

  it('generates receipt PDF and returns it', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(sampleSale)
    mockQueryMany
      .mockResolvedValueOnce(sampleItems as any) // sale items
      .mockResolvedValueOnce(sampleSettings as any) // settings
    mockGeneratePDF.mockResolvedValue(fakePdfBuffer as any)

    const res = await GET(makeRequest(SALE_ID), { params: Promise.resolve({ id: SALE_ID }) })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toMatch(/receipt-INV-2026-001/)
  })

  it('calls generateReceiptPDF with correct business settings', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(sampleSale)
    mockQueryMany.mockResolvedValueOnce(sampleItems as any).mockResolvedValueOnce(sampleSettings as any)
    mockGeneratePDF.mockResolvedValue(fakePdfBuffer as any)

    await GET(makeRequest(SALE_ID), { params: Promise.resolve({ id: SALE_ID }) })

    expect(mockGeneratePDF).toHaveBeenCalledWith(
      expect.objectContaining({ invoice_number: 'INV-2026-001' }),
      expect.any(Array),
      expect.objectContaining({ gstin: '29ABCDE1234F1Z5', legalName: 'Test Store Pvt Ltd' })
    )
  })

  it('uses sale_number as filename fallback when invoice_number is null', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ ...sampleSale, invoice_number: null })
    mockQueryMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    mockGeneratePDF.mockResolvedValue(fakePdfBuffer as any)

    const res = await GET(makeRequest(SALE_ID), { params: Promise.resolve({ id: SALE_ID }) })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toMatch(/receipt-SALE-001/)
  })

  it('handles empty settings gracefully with empty strings', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(sampleSale)
    mockQueryMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]) // no settings rows
    mockGeneratePDF.mockResolvedValue(fakePdfBuffer as any)

    const res = await GET(makeRequest(SALE_ID), { params: Promise.resolve({ id: SALE_ID }) })
    expect(res.status).toBe(200)
    expect(mockGeneratePDF).toHaveBeenCalledWith(
      expect.any(Object),
      [],
      expect.objectContaining({ gstin: '', legalName: '' })
    )
  })

  it('returns 500 on unexpected error', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockRejectedValue(new Error('DB failure'))
    const res = await GET(makeRequest(SALE_ID), { params: Promise.resolve({ id: SALE_ID }) })
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('DB failure')
  })
})
