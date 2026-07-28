import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/db', () => ({ queryMany: vi.fn(), queryOne: vi.fn() }))

// ── Imports after mocks ──────────────────────────────────────────────────────

import { GET as GSTR1_GET } from '@/app/api/admin/gst/gstr1/route'
import { GET as GSTR3B_GET } from '@/app/api/admin/gst/gstr3b/route'
import { authenticateAdmin } from '@/lib/jwt'
import { queryMany, queryOne } from '@/lib/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockQueryMany = vi.mocked(queryMany)
const mockQueryOne = vi.mocked(queryOne)

const SUPER_ADMIN = { adminId: 'admin-1', role: 'super_admin', scopes: [] }

function makeReq(url: string) {
  return new NextRequest(new Request(url))
}

// ── GSTR-1 CSV builder + HSN summary branch coverage ──────────────────────────
// Targets uncovered branches in buildGSTR1CSV (line 147 null-coalescing) and
// buildHsnSummary fallback branches (missing hsn_code / gst_rate → '9999' / '18').

describe('GET /api/admin/gst/gstr1 — CSV + HSN branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(SUPER_ADMIN as any)
  })

  it('builds CSV with populated IRN fields and a present invoice_date', async () => {
    mockQueryMany.mockResolvedValue([
      {
        invoice_number: 'INV-CSV-1',
        invoice_date: '2024-05-10',
        order_number: 'ORD-CSV-1',
        customer_name: 'Big Buyer Pvt Ltd',
        buyer_gstin: '27AAAAA0000A1Z5',
        is_igst: true,
        taxable_amount: '2000',
        cgst_amount: '0',
        sgst_amount: '0',
        igst_amount: '360',
        total_amount: '2360',
        buyer_state: 'Maharashtra',
        irn: 'IRN-ABC-123',
        irn_ack_no: 'ACK-999',
        irn_ack_dt: '2024-05-10',
        items: [
          { product_name: 'Widget', hsn_code: '8481', gst_rate: 18, quantity: 5, taxable_amount: '2000', cgst_amount: '0', sgst_amount: '0', igst_amount: '360', total_price: '2360' },
        ],
      },
    ] as any)

    const res = await GSTR1_GET(makeReq('http://localhost/api/admin/gst/gstr1?from=2024-05-01&to=2024-05-31&format=csv'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/csv')
    const csv = await res.text()
    // B2B row (buyer_gstin present) with IRN + Ack columns populated
    expect(csv).toContain('INV-CSV-1')
    expect(csv).toContain('B2B')
    expect(csv).toContain('IRN-ABC-123')
    expect(csv).toContain('ACK-999')
    // total tax = 0 + 0 + 360 = 360.00 (line 147 parseFloat path)
    expect(csv).toContain('360.00')
    // invoice_date rendered via toLocaleDateString (present-date branch)
    expect(csv).not.toContain('INV-CSV-1,,')
  })

  it('builds CSV rows for B2C with missing invoice_date, null irn and null tax amounts', async () => {
    mockQueryMany.mockResolvedValue([
      {
        invoice_number: 'INV-CSV-2',
        invoice_date: null,
        order_number: 'ORD-CSV-2',
        customer_name: 'Walk-in',
        buyer_gstin: null,
        is_igst: false,
        taxable_amount: '100',
        // cgst/sgst/igst missing → exercise `|| 0` fallback on line 147
        cgst_amount: null,
        sgst_amount: null,
        igst_amount: null,
        total_amount: '118',
        buyer_state: null,
        irn: null,
        irn_ack_no: null,
        irn_ack_dt: null,
        items: [],
      },
    ] as any)

    const res = await GSTR1_GET(makeReq('http://localhost/api/admin/gst/gstr1?from=2024-05-01&to=2024-05-31&format=csv'))
    expect(res.status).toBe(200)
    const csv = await res.text()
    expect(csv).toContain('INV-CSV-2')
    expect(csv).toContain('B2C')
    // null tax amounts coalesce to 0 → 0.00
    expect(csv).toContain('0.00')
  })

  it('buildHsnSummary uses 9999/18 fallbacks when item hsn_code/gst_rate are missing', async () => {
    mockQueryMany.mockResolvedValue([
      {
        invoice_number: 'INV-HSN-1',
        invoice_date: '2024-05-12',
        order_number: 'ORD-HSN-1',
        customer_name: 'HSN Buyer',
        buyer_gstin: '29AAAAA0000A1Z5',
        is_igst: false,
        taxable_amount: '1000',
        cgst_amount: '90',
        sgst_amount: '90',
        igst_amount: '0',
        total_amount: '1180',
        buyer_state: 'Karnataka',
        irn: null,
        irn_ack_no: null,
        irn_ack_dt: null,
        items: [
          // hsn_code / gst_rate absent → COALESCE-equivalent fallbacks in code path
          { product_name: 'Unclassified', hsn_code: null, gst_rate: null, quantity: 1, taxable_amount: '1000', cgst_amount: '90', sgst_amount: '90', igst_amount: '0', total_price: '1180' },
        ],
      },
    ] as any)

    const res = await GSTR1_GET(makeReq('http://localhost/api/admin/gst/gstr1?from=2024-05-01&to=2024-05-31'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.hsnSummary).toHaveLength(1)
    const h = json.hsnSummary[0]
    expect(h.hsnCode).toBe('9999')
    expect(h.gstRate).toBe(18)
    expect(h.taxableVal).toBeCloseTo(1000)
    expect(h.cgstAmt).toBeCloseTo(90)
    expect(h.totalTax).toBeCloseTo(180)
  })

  it('buildHsnSummary aggregates multiple items sharing the same hsn+rate key', async () => {
    mockQueryMany.mockResolvedValue([
      {
        invoice_number: 'INV-HSN-2',
        invoice_date: '2024-05-13',
        order_number: 'ORD-HSN-2',
        customer_name: 'Multi Item',
        buyer_gstin: null,
        is_igst: false,
        taxable_amount: '300',
        cgst_amount: '27',
        sgst_amount: '27',
        igst_amount: '0',
        total_amount: '354',
        buyer_state: 'Karnataka',
        irn: null,
        irn_ack_no: null,
        irn_ack_dt: null,
        items: [
          { product_name: 'A', hsn_code: '7318', gst_rate: 18, quantity: 1, taxable_amount: '100', cgst_amount: '9', sgst_amount: '9', igst_amount: '0', total_price: '118' },
          { product_name: 'B', hsn_code: '7318', gst_rate: 18, quantity: 1, taxable_amount: '200', cgst_amount: '18', sgst_amount: '18', igst_amount: '0', total_price: '236' },
        ],
      },
    ] as any)

    const res = await GSTR1_GET(makeReq('http://localhost/api/admin/gst/gstr1?from=2024-05-01&to=2024-05-31'))
    const json = await res.json()
    expect(json.hsnSummary).toHaveLength(1)
    expect(json.hsnSummary[0].taxableVal).toBeCloseTo(300)
    expect(json.hsnSummary[0].cgstAmt).toBeCloseTo(27)
  })
})

// ── GSTR-3B table 3.2 filter branch coverage ──────────────────────────────────
// Line 84: byRate.filter((r) => r.is_igst && !r.buyer_gstin). Existing tests never
// feed a row with is_igst=true AND no buyer_gstin, so the truthy branch is unhit.

describe('GET /api/admin/gst/gstr3b — table 3.2 inter-state filter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(SUPER_ADMIN as any)
  })

  it('returns 401 when not super_admin', async () => {
    mockAuth.mockResolvedValue({ adminId: 'x', role: 'admin', scopes: [] } as any)
    const res = await GSTR3B_GET(makeReq('http://localhost/api/admin/gst/gstr3b?from=2024-05-01&to=2024-05-31'))
    expect(res.status).toBe(401)
  })

  it('populates table32 for inter-state supplies to unregistered persons', async () => {
    mockQueryOne.mockResolvedValue({
      total_taxable: '5000', total_cgst: '0', total_sgst: '0', total_igst: '900', invoice_count: 2,
    } as any)
    // byRate rows, then site_settings rows
    mockQueryMany
      .mockResolvedValueOnce([
        // is_igst true + no buyer_gstin → included in table32 (line 84 truthy branch)
        { gst_rate: '18', is_igst: true, buyer_gstin: null, taxable: '5000', cgst: '0', sgst: '0', igst: '900' },
        // is_igst true but has buyer_gstin → excluded
        { gst_rate: '12', is_igst: true, buyer_gstin: '27AAAAA0000A1Z5', taxable: '1000', cgst: '0', sgst: '0', igst: '120' },
        // intra-state → excluded
        { gst_rate: '18', is_igst: false, buyer_gstin: null, taxable: '2000', cgst: '180', sgst: '180', igst: '0' },
      ] as any)
      .mockResolvedValueOnce([
        { key: 'business_gstin', value: '29AAAAA0000A1Z5' },
        { key: 'business_legal_name', value: 'Jeffi Stores' },
      ] as any)

    const res = await GSTR3B_GET(makeReq('http://localhost/api/admin/gst/gstr3b?from=2024-05-01&to=2024-05-31'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.gstin).toBe('29AAAAA0000A1Z5')
    expect(json.legalName).toBe('Jeffi Stores')
    expect(json.table32.supplies).toHaveLength(1)
    expect(json.table32.supplies[0]).toMatchObject({ gstRate: 18, taxableValue: 5000, igst: 900 })
  })

  it('emits CSV including the by-rate breakup section', async () => {
    mockQueryOne.mockResolvedValue({
      total_taxable: '5000', total_cgst: '0', total_sgst: '0', total_igst: '900', invoice_count: 1,
    } as any)
    mockQueryMany
      .mockResolvedValueOnce([
        { gst_rate: '18', is_igst: true, buyer_gstin: null, taxable: '5000', cgst: '0', sgst: '0', igst: '900' },
      ] as any)
      .mockResolvedValueOnce([] as any) // no site_settings → empty gstin/legalName branch

    const res = await GSTR3B_GET(makeReq('http://localhost/api/admin/gst/gstr3b?from=2024-05-01&to=2024-05-31&format=csv'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/csv')
    const csv = await res.text()
    expect(csv).toContain('GSTR-3B Summary')
    expect(csv).toContain('Inter-State')
    expect(csv).toContain('18%')
  })
})
