import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))
vi.mock('@/lib/documents/po-pdf', () => ({
  generatePurchaseOrderPDF: vi.fn(),
}))

import { GET } from '@/app/api/public/purchaseorder/[token]/pdf/route'
import { queryOne, queryMany } from '@/lib/shared/db'
import { generatePurchaseOrderPDF } from '@/lib/documents/po-pdf'

const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)
const mockGeneratePDF = vi.mocked(generatePurchaseOrderPDF)

const params = { params: Promise.resolve({ token: 'po-tok' }) }

function makeRequest() {
  return new Request('http://localhost/api/public/purchaseorder/po-tok/pdf')
}

const mockPO = {
  id: 'po1',
  po_number: 'PO/2024/001',
  supplier_name: 'Supplier Co',
  contact_name: 'John',
  supplier_email: 'supplier@example.com',
  supplier_address: '123 Industrial Area',
  supplier_gstin: 'GST123',
  view_token: 'po-tok',
}

const mockItems = [
  { product_name: 'Hex Bolt M6', variant_name: 'M6x20', quantity: 100, unit_cost: '5.00' },
]

const mockSettings = [
  { key: 'business_legal_name', value: 'Jeffi Stores Pvt Ltd' },
  { key: 'business_trade_name', value: 'Jeffi Stores' },
  { key: 'business_address', value: 'Chennai, TN' },
  { key: 'business_phone', value: '9999999999' },
  { key: 'business_email', value: 'info@jeffistores.com' },
  { key: 'business_gstin', value: '29ABCDE1234F1Z5' },
]

describe('GET /api/public/purchaseorder/[token]/pdf', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 404 when PO not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(404)
  })

  it('generates and returns PDF binary on success', async () => {
    const pdfBuffer = Buffer.from('fake-po-pdf')
    mockQueryOne.mockResolvedValueOnce(mockPO)
    mockQueryMany.mockResolvedValueOnce(mockItems).mockResolvedValueOnce(mockSettings)
    mockGeneratePDF.mockResolvedValueOnce(pdfBuffer as any)

    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toContain('PO-2024-001.pdf')
    expect(res.headers.get('content-length')).toBe(String(pdfBuffer.length))
    expect(mockGeneratePDF).toHaveBeenCalledTimes(1)
  })

  it('replaces slashes in po_number for filename', async () => {
    const pdfBuffer = Buffer.from('pdf')
    mockQueryOne.mockResolvedValueOnce({ ...mockPO, po_number: 'PO/2024/055' })
    mockQueryMany.mockResolvedValueOnce(mockItems).mockResolvedValueOnce(mockSettings)
    mockGeneratePDF.mockResolvedValueOnce(pdfBuffer as any)

    const res = await GET(makeRequest() as any, params as any)
    expect(res.headers.get('content-disposition')).toContain('PO-2024-055.pdf')
    expect(res.headers.get('content-disposition')).not.toContain('/')
  })

  it('passes correct business settings to generatePurchaseOrderPDF', async () => {
    const pdfBuffer = Buffer.from('pdf')
    mockQueryOne.mockResolvedValueOnce(mockPO)
    mockQueryMany.mockResolvedValueOnce(mockItems).mockResolvedValueOnce(mockSettings)
    mockGeneratePDF.mockResolvedValueOnce(pdfBuffer as any)

    await GET(makeRequest() as any, params as any)
    const callArgs = mockGeneratePDF.mock.calls[0]
    expect(callArgs[2]).toMatchObject({
      legalName: 'Jeffi Stores Pvt Ltd',
      gstin: '29ABCDE1234F1Z5',
    })
  })

  it('returns 500 when PDF generation throws', async () => {
    mockQueryOne.mockResolvedValueOnce(mockPO)
    mockQueryMany.mockResolvedValueOnce(mockItems).mockResolvedValueOnce(mockSettings)
    mockGeneratePDF.mockRejectedValueOnce(new Error('render error'))

    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('render error')
  })
})
