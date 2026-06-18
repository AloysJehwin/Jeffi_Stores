import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))
vi.mock('@/lib/quotation-pdf', () => ({
  generateQuotationPDF: vi.fn(),
}))

import { GET } from '@/app/api/public/quotation/[token]/pdf/route'
import { queryOne, queryMany } from '@/lib/db'
import { generateQuotationPDF } from '@/lib/quotation-pdf'

const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)
const mockGeneratePDF = vi.mocked(generateQuotationPDF)

const params = { params: { token: 'qt-tok' } }

function makeRequest() {
  return new Request('http://localhost/api/public/quotation/qt-tok/pdf')
}

const mockQuotation = {
  id: 'qt1',
  quote_number: 'QT/2024/001',
  customer_name: 'Test Customer',
  valid_until: '2024-12-31',
  view_token: 'qt-tok',
}

const mockItems = [
  {
    description: 'Hex Bolt M6',
    hsn_code: '7318',
    gst_rate: '18',
    quantity: '100',
    unit: 'nos',
    rate: '5.00',
    discount_pct: '0',
    amount: '500.00',
  },
]

const mockSettings = [
  { key: 'business_gstin', value: '29ABCDE1234F1Z5' },
  { key: 'business_legal_name', value: 'Jeffi Stores Pvt Ltd' },
  { key: 'business_trade_name', value: 'Jeffi Stores' },
  { key: 'business_address', value: 'Chennai, TN' },
  { key: 'business_state', value: 'Tamil Nadu' },
  { key: 'business_state_code', value: '33' },
  { key: 'business_phone', value: '9999999999' },
  { key: 'business_email', value: 'info@jeffistores.com' },
  { key: 'bank_name', value: 'HDFC' },
  { key: 'bank_account', value: '123456789' },
  { key: 'bank_ifsc', value: 'HDFC0001234' },
  { key: 'bank_branch', value: 'Chennai' },
]

describe('GET /api/public/quotation/[token]/pdf', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 404 when quotation not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(404)
  })

  it('generates and returns PDF binary on success', async () => {
    const pdfBuffer = Buffer.from('fake-quotation-pdf')
    mockQueryOne.mockResolvedValueOnce(mockQuotation)
    mockQueryMany.mockResolvedValueOnce(mockItems).mockResolvedValueOnce(mockSettings)
    mockGeneratePDF.mockResolvedValueOnce(pdfBuffer as any)

    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toContain('quotation-QT-2024-001.pdf')
    expect(mockGeneratePDF).toHaveBeenCalledTimes(1)
  })

  it('replaces slashes in quote_number for filename', async () => {
    const pdfBuffer = Buffer.from('pdf')
    mockQueryOne.mockResolvedValueOnce({ ...mockQuotation, quote_number: 'QT/2024/055' })
    mockQueryMany.mockResolvedValueOnce(mockItems).mockResolvedValueOnce(mockSettings)
    mockGeneratePDF.mockResolvedValueOnce(pdfBuffer as any)

    const res = await GET(makeRequest() as any, params as any)
    expect(res.headers.get('content-disposition')).toContain('QT-2024-055')
    expect(res.headers.get('content-disposition')).not.toContain('/')
  })

  it('passes correct business settings to generateQuotationPDF', async () => {
    const pdfBuffer = Buffer.from('pdf')
    mockQueryOne.mockResolvedValueOnce(mockQuotation)
    mockQueryMany.mockResolvedValueOnce(mockItems).mockResolvedValueOnce(mockSettings)
    mockGeneratePDF.mockResolvedValueOnce(pdfBuffer as any)

    await GET(makeRequest() as any, params as any)
    const callArgs = mockGeneratePDF.mock.calls[0]
    expect(callArgs[2]).toMatchObject({
      gstin: '29ABCDE1234F1Z5',
      legalName: 'Jeffi Stores Pvt Ltd',
      bankName: 'HDFC',
    })
  })

  it('converts item numeric fields correctly', async () => {
    const pdfBuffer = Buffer.from('pdf')
    mockQueryOne.mockResolvedValueOnce(mockQuotation)
    mockQueryMany.mockResolvedValueOnce(mockItems).mockResolvedValueOnce(mockSettings)
    mockGeneratePDF.mockResolvedValueOnce(pdfBuffer as any)

    await GET(makeRequest() as any, params as any)
    const callArgs = mockGeneratePDF.mock.calls[0]
    const passedItems = callArgs[1] as any[]
    expect(passedItems[0].gst_rate).toBe(18)
    expect(passedItems[0].quantity).toBe(100)
    expect(passedItems[0].rate).toBe(5)
    expect(passedItems[0].amount).toBe(500)
  })

  it('returns 500 when PDF generation throws', async () => {
    mockQueryOne.mockResolvedValueOnce(mockQuotation)
    mockQueryMany.mockResolvedValueOnce(mockItems).mockResolvedValueOnce(mockSettings)
    mockGeneratePDF.mockRejectedValueOnce(new Error('render error'))

    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('render error')
  })
})
