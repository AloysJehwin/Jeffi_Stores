import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  queryMany: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { GET } from '@/app/api/admin/gst/gstr1/route'
import { authenticateAdmin } from '@/lib/jwt'
import { queryMany } from '@/lib/db'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SUPER_ADMIN = { adminId: 'admin-1', role: 'super_admin', scopes: [] }
const REGULAR_ADMIN = { adminId: 'admin-2', role: 'admin', scopes: [] }

function makeReq(url: string) {
  return new NextRequest(new Request(url))
}

// Sample rows returned by the DB query
const sampleRows = [
  {
    invoice_number: 'INV-001',
    invoice_date: '2024-04-15',
    order_number: 'ORD-001',
    customer_name: 'Acme Corp',
    buyer_gstin: '22AAAAA0000A1Z5',
    is_igst: false,
    taxable_amount: '1000',
    cgst_amount: '90',
    sgst_amount: '90',
    igst_amount: '0',
    total_amount: '1180',
    buyer_state: 'Chhattisgarh',
    irn: null,
    irn_ack_no: null,
    irn_ack_dt: null,
    items: [
      { product_name: 'Bolt M6', hsn_code: '7318', gst_rate: 18, quantity: 10, taxable_amount: '1000', cgst_amount: '90', sgst_amount: '90', igst_amount: '0', total_price: '1180' },
    ],
  },
  {
    invoice_number: 'INV-002',
    invoice_date: '2024-04-16',
    order_number: 'ORD-002',
    customer_name: 'Retail Customer',
    buyer_gstin: null,
    is_igst: false,
    taxable_amount: '500',
    cgst_amount: '45',
    sgst_amount: '45',
    igst_amount: '0',
    total_amount: '590',
    buyer_state: 'Chhattisgarh',
    irn: null,
    irn_ack_no: null,
    irn_ack_dt: null,
    items: [],
  },
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/admin/gst/gstr1', () => {
  beforeEach(() => {
    vi.mocked(authenticateAdmin).mockResolvedValue(SUPER_ADMIN as any)
    vi.mocked(queryMany).mockResolvedValue(sampleRows as any)
  })

  it('returns GSTR-1 data with b2b/b2c split and hsn summary', async () => {
    const res = await GET(makeReq('http://localhost/api/admin/gst/gstr1?from=2024-04-01&to=2024-04-30'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toMatchObject({
      period: { from: '2024-04-01', to: '2024-04-30' },
      summary: {
        totalInvoices: 2,
        b2bCount: 1,
        b2cCount: 1,
      },
      b2b: expect.any(Array),
      b2c: expect.any(Array),
      hsnSummary: expect.any(Array),
    })
    expect(json.b2b).toHaveLength(1)
    expect(json.b2c).toHaveLength(1)
  })

  it('returns 400 when from param is missing', async () => {
    const res = await GET(makeReq('http://localhost/api/admin/gst/gstr1?to=2024-04-30'))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('from')
  })

  it('returns 400 when to param is missing', async () => {
    const res = await GET(makeReq('http://localhost/api/admin/gst/gstr1?from=2024-04-01'))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('to')
  })

  it('returns 400 when both date params are missing', async () => {
    const res = await GET(makeReq('http://localhost/api/admin/gst/gstr1'))
    expect(res.status).toBe(400)
  })

  it('returns 403 when authenticated but missing gst:read scope', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(REGULAR_ADMIN as any)

    const res = await GET(makeReq('http://localhost/api/admin/gst/gstr1?from=2024-04-01&to=2024-04-30'))
    expect(res.status).toBe(403)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)

    const res = await GET(makeReq('http://localhost/api/admin/gst/gstr1?from=2024-04-01&to=2024-04-30'))
    expect(res.status).toBe(401)
  })

  it('returns empty b2b/b2c arrays when no invoices found', async () => {
    vi.mocked(queryMany).mockResolvedValue([] as any)

    const res = await GET(makeReq('http://localhost/api/admin/gst/gstr1?from=2024-04-01&to=2024-04-30'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.summary.totalInvoices).toBe(0)
    expect(json.b2b).toEqual([])
    expect(json.b2c).toEqual([])
    expect(json.hsnSummary).toEqual([])
  })

  it('computes correct totals in summary', async () => {
    const res = await GET(makeReq('http://localhost/api/admin/gst/gstr1?from=2024-04-01&to=2024-04-30'))
    const json = await res.json()

    expect(json.summary.totalTaxable).toBeCloseTo(1500)
    expect(json.summary.totalCgst).toBeCloseTo(135)
    expect(json.summary.totalSgst).toBeCloseTo(135)
    expect(json.summary.totalInvoiceValue).toBeCloseTo(1770)
  })

  it('returns CSV format when format=csv is specified', async () => {
    const res = await GET(makeReq('http://localhost/api/admin/gst/gstr1?from=2024-04-01&to=2024-04-30&format=csv'))

    expect(res.status).toBe(200)
    const contentType = res.headers.get('Content-Type')
    expect(contentType).toContain('text/csv')
  })

  it('returns 500 on database error', async () => {
    vi.mocked(queryMany).mockRejectedValue(new Error('Connection timeout'))

    const res = await GET(makeReq('http://localhost/api/admin/gst/gstr1?from=2024-04-01&to=2024-04-30'))
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('Connection timeout')
  })
})
