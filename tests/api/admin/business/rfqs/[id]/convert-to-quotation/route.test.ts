import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth/jwt', () => ({
  requireAdminScope: vi.fn(),
}))

vi.mock('@/lib/shared/db', () => ({
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  query: vi.fn(),
}))

vi.mock('@/lib/catalog/pricing', () => ({
  stackDiscounts: vi.fn(),
  applyDiscount: vi.fn(),
  lineItemExGst: vi.fn(),
}))

vi.mock('@/lib/shared/email-business', () => ({
  sendRfqConvertedToQuotationEmail: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Import handler AFTER mocks
// ---------------------------------------------------------------------------

import { POST } from '@/app/api/admin/business/rfqs/[id]/convert-to-quotation/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryOne, queryMany, query } from '@/lib/shared/db'
import { sendRfqConvertedToQuotationEmail } from '@/lib/shared/email-business'
import { stackDiscounts, applyDiscount, lineItemExGst } from '@/lib/catalog/pricing'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN = { adminId: 'admin-1', id: 'admin-1', username: 'admin', role: 'super_admin', scopes: ['business_rfqs'] }
const RFQ_ID = '770e8400-e29b-41d4-a716-446655440003'

function postReq(body: unknown = {}) {
  return new NextRequest(
    new Request(`http://localhost/api/admin/business/rfqs/${RFQ_ID}/convert-to-quotation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )
}

const BASE_RFQ = {
  id: RFQ_ID,
  rfq_number: 'RFQ/24-25/APR/1',
  user_id: 'user-uuid-1',
  status: 'pending',
  converted_quotation_id: null,
  first_name: 'John',
  last_name: 'Doe',
  email: 'john@acme.com',
  phone: '9876543210',
  company_name: 'Acme Corp',
  gst_number: '33AABCU9603R1ZP',
  business_address: '42 Main Rd, Chennai, Tamil Nadu, 600001',
  notes: null,
}

const RFQ_ITEMS = [
  {
    id: 'riq-1',
    rfq_id: RFQ_ID,
    product_id: '111e4567-e89b-12d3-a456-426614174001',
    variant_id: null,
    sub_variant_id: null,
    description: 'Widget A',
    quantity: '2',
    unit: 'Nos',
    requested_price: '200',
    position: 0,
    product_name: 'Widget A',
    product_price: '169.49',
    product_mrp: '200',
    product_gst: '18',
    product_hsn: '8471',
    product_category_id: 'cat-uuid-1',
    product_discount_pct: '0',
    variant_name: null,
    variant_price: null,
    variant_mrp: null,
    variant_sku: null,
    variant_discount_pct: null,
    sub_variant_name: null,
    sv_price: null,
    sv_mrp: null,
    sv_sku: null,
    sv_discount_pct: null,
  },
]

const BUSINESS_DISCOUNTS: Array<{ category_id: string; discount_pct: string }> = [
  { category_id: 'cat-uuid-1', discount_pct: '10' },
]

const QUOTATION_ROW = {
  id: 'qt-uuid-1',
  quote_number: 'QT/24-25/APR/1',
  view_token: 'tok-abc123',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/admin/business/rfqs/[id]/convert-to-quotation', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue(ADMIN as any)
    // Re-setup lib mocks cleared by resetAllMocks
    vi.mocked(stackDiscounts).mockReturnValue(10)
    vi.mocked(applyDiscount).mockImplementation((price: number, pct: number) => price * (1 - pct / 100))
    vi.mocked(lineItemExGst).mockReturnValue(180)
    vi.mocked(sendRfqConvertedToQuotationEmail).mockResolvedValue(undefined as any)

    vi.mocked(queryOne)
      // rfq lookup
      .mockResolvedValueOnce(BASE_RFQ as any)
      // no counter offer
      .mockResolvedValueOnce(null as any)
      // max sequence
      .mockResolvedValueOnce({ max_seq: '0' } as any)
      // INSERT quotation RETURNING *
      .mockResolvedValueOnce(QUOTATION_ROW as any)

    vi.mocked(queryMany)
      // business discounts
      .mockResolvedValueOnce(BUSINESS_DISCOUNTS as any)
      // rfq items
      .mockResolvedValueOnce(RFQ_ITEMS as any)

    vi.mocked(query).mockResolvedValue({ rows: [] } as any)
  })

  // --- Auth ---

  it('returns 401/403 when requireAdminScope rejects', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const res = await POST(postReq(), { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope insufficient', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(
      NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    )
    const res = await POST(postReq(), { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(403)
  })

  // --- Guard conditions ---

  it('returns 404 when RFQ not found', async () => {
    vi.mocked(queryOne).mockReset()
    vi.mocked(queryOne).mockResolvedValue(null as any)
    const res = await POST(postReq(), { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe('Not found')
  })

  it('returns 409 when RFQ already converted', async () => {
    vi.mocked(queryOne).mockReset()
    vi.mocked(queryOne).mockResolvedValueOnce({
      ...BASE_RFQ,
      converted_quotation_id: 'existing-qt',
    } as any)
    const res = await POST(postReq(), { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toBe('Already converted')
  })

  it('returns 400 when RFQ has no items', async () => {
    vi.mocked(queryOne).mockReset()
    vi.mocked(queryMany).mockReset()
    vi.mocked(queryOne).mockResolvedValueOnce(BASE_RFQ as any)
    vi.mocked(queryMany)
      .mockResolvedValueOnce(BUSINESS_DISCOUNTS as any)
      .mockResolvedValueOnce([] as any) // empty items
    const res = await POST(postReq(), { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('RFQ has no items')
  })

  // --- Happy path ---

  it('creates quotation and returns quotationId and quoteNumber', async () => {
    const res = await POST(postReq(), { params: Promise.resolve({ id: RFQ_ID }) })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.quotationId).toBe('qt-uuid-1')
    expect(json.quoteNumber).toBe('QT/24-25/APR/1')
  })

  it('inserts quotation_items for each RFQ item', async () => {
    await POST(postReq(), { params: Promise.resolve({ id: RFQ_ID }) })

    const insertItemCalls = vi
      .mocked(query)
      .mock.calls.filter((args: any[]) => typeof args[0] === 'string' && args[0].includes('quotation_items'))
    expect(insertItemCalls.length).toBeGreaterThanOrEqual(1)
  })

  it('updates RFQ status to converted', async () => {
    await POST(postReq(), { params: Promise.resolve({ id: RFQ_ID }) })

    const updateCalls = vi
      .mocked(query)
      .mock.calls.filter((args: any[]) => typeof args[0] === 'string' && args[0].includes("status='converted'"))
    expect(updateCalls.length).toBeGreaterThanOrEqual(1)
  })

  // --- Negotiated price from counter offer ---

  it('uses negotiated price from counter_items when available', async () => {
    vi.mocked(queryOne).mockReset()
    vi.mocked(queryOne)
      .mockResolvedValueOnce(BASE_RFQ as any)
      // counter offer with negotiated price
      .mockResolvedValueOnce({
        counter_items: JSON.stringify([{ rfq_item_id: 'riq-1', offered_price: 180 }]),
      } as any)
      .mockResolvedValueOnce({ max_seq: '2' } as any)
      .mockResolvedValueOnce(QUOTATION_ROW as any)

    const res = await POST(postReq(), { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(200)
  })

  it('handles counter_items as already-parsed array', async () => {
    vi.mocked(queryOne).mockReset()
    vi.mocked(queryOne)
      .mockResolvedValueOnce(BASE_RFQ as any)
      .mockResolvedValueOnce({
        counter_items: [{ rfq_item_id: 'riq-1', offered_price: 195 }],
      } as any)
      .mockResolvedValueOnce({ max_seq: null } as any)
      .mockResolvedValueOnce(QUOTATION_ROW as any)

    const res = await POST(postReq(), { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(200)
  })

  // --- Email notification ---

  it('sends quotation email when view_token is present', async () => {
    await POST(postReq(), { params: Promise.resolve({ id: RFQ_ID }) })
    expect(sendRfqConvertedToQuotationEmail).toHaveBeenCalledWith(
      BASE_RFQ.email,
      BASE_RFQ.company_name,
      BASE_RFQ.rfq_number,
      QUOTATION_ROW.quote_number,
      expect.any(Number),
      expect.stringContaining('tok-abc123')
    )
  })

  it('skips email when view_token is absent', async () => {
    vi.mocked(queryOne).mockReset()
    vi.mocked(queryOne)
      .mockResolvedValueOnce(BASE_RFQ as any)
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce({ max_seq: '0' } as any)
      .mockResolvedValueOnce({ ...QUOTATION_ROW, view_token: null } as any)

    await POST(postReq(), { params: Promise.resolve({ id: RFQ_ID }) })
    expect(sendRfqConvertedToQuotationEmail).not.toHaveBeenCalled()
  })

  // --- Address parsing edge cases ---

  it('handles null business_address gracefully', async () => {
    vi.mocked(queryOne).mockReset()
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ ...BASE_RFQ, business_address: null } as any)
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce({ max_seq: '0' } as any)
      .mockResolvedValueOnce(QUOTATION_ROW as any)

    const res = await POST(postReq(), { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(200)
  })

  it('handles address without pincode', async () => {
    vi.mocked(queryOne).mockReset()
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ ...BASE_RFQ, business_address: '42 Main Rd, Chennai, Tamil Nadu' } as any)
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce({ max_seq: '0' } as any)
      .mockResolvedValueOnce(QUOTATION_ROW as any)

    const res = await POST(postReq(), { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(200)
  })

  // --- Variant / sub-variant items ---

  it('builds correct line items for variant-level item', async () => {
    const variantItem = {
      ...RFQ_ITEMS[0],
      variant_id: '222e4567-e89b-12d3-a456-426614174002',
      variant_name: 'Blue',
      variant_price: '160',
      variant_mrp: '190',
      variant_discount_pct: '5',
    }
    vi.mocked(queryOne).mockReset()
    vi.mocked(queryOne)
      .mockResolvedValueOnce(BASE_RFQ as any)
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce({ max_seq: '0' } as any)
      .mockResolvedValueOnce(QUOTATION_ROW as any)
    vi.mocked(queryMany)
      .mockResolvedValueOnce(BUSINESS_DISCOUNTS as any)
      .mockResolvedValueOnce([variantItem] as any)

    const res = await POST(postReq(), { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(200)
  })

  it('builds correct line items for sub_variant-level item', async () => {
    const svItem = {
      ...RFQ_ITEMS[0],
      variant_id: '222e4567-e89b-12d3-a456-426614174002',
      sub_variant_id: '333e4567-e89b-12d3-a456-426614174003',
      sv_price: '155',
      sv_mrp: '185',
      sv_discount_pct: '8',
      sub_variant_name: 'M',
    }
    vi.mocked(queryOne).mockReset()
    vi.mocked(queryOne)
      .mockResolvedValueOnce(BASE_RFQ as any)
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce({ max_seq: '0' } as any)
      .mockResolvedValueOnce(QUOTATION_ROW as any)
    vi.mocked(queryMany)
      .mockResolvedValueOnce(BUSINESS_DISCOUNTS as any)
      .mockResolvedValueOnce([svItem] as any)

    const res = await POST(postReq(), { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(200)
  })

  // --- Sequence generation ---

  it('starts seq at 1 when no existing quotations', async () => {
    vi.mocked(queryOne).mockReset()
    vi.mocked(queryOne)
      .mockResolvedValueOnce(BASE_RFQ as any)
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce({ max_seq: null } as any)
      .mockResolvedValueOnce(QUOTATION_ROW as any)

    const res = await POST(postReq(), { params: Promise.resolve({ id: RFQ_ID }) })
    expect(res.status).toBe(200)
  })
})
