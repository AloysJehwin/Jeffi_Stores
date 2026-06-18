import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (before imports) ────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))
vi.mock('@/lib/ewaybill', () => ({
  generateEWayBill: vi.fn(),
  isEWayBillConfigured: vi.fn(),
}))
vi.mock('@/lib/validate', () => ({
  parseBody: vi.fn(),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/orders/[id]/ewaybill-generate/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany } from '@/lib/db'
import { generateEWayBill, isEWayBillConfigured } from '@/lib/ewaybill'
import { parseBody } from '@/lib/validate'

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'a1', role: 'admin', scopes: ['orders'] }
const PARAMS = { params: { id: 'order-1' } }

function makePost(body: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/admin/orders/order-1/ewaybill-generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const BASE_ORDER = {
  id: 'order-1',
  invoice_number: 'INV-001',
  eway_bill_no: null,
  invoice_date: '2024-01-15',
  created_at: '2024-01-15T10:00:00Z',
  total_amount: '1180',
  cgst_amount: '90',
  sgst_amount: '90',
  igst_amount: '0',
  is_igst: false,
  buyer_gstin: '33AABCU9603R1ZX',
  full_name: 'Test Customer',
  address_line1: '123 Main St',
  city: 'Chennai',
  state: 'Tamil Nadu',
  postal_code: '600001',
  state_code: '33',
  awb_number: null,
}

const SETTINGS_ROWS = [
  { key: 'business_gstin', value: '33AABCJ1234Z1ZA' },
  { key: 'business_trade_name', value: 'Jeffi Stores' },
  { key: 'business_address', value: '456 Market St' },
  { key: 'business_city', value: 'Chennai' },
  { key: 'business_pincode', value: '600002' },
  { key: 'business_state_code', value: '33' },
]

const ORDER_ITEMS = [
  {
    product_name: 'Bolt M8',
    hsn_code: '7318',
    quantity: 10,
    taxable_amount: '1000',
    gst_rate: '18',
    total_price: '1000',
  },
]

const EWB_RESULT = {
  ewbNo: 'EWB12345',
  ewbDt: '15/01/2024',
  ewbValidTill: '17/01/2024',
  status: 'generated',
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/orders/[id]/ewaybill-generate', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 403 when missing orders scope', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(403)
  })

  it('returns 404 when order not found', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValueOnce(null as any)
    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: 'Order not found' })
  })

  it('returns 422 when invoice not yet generated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValueOnce({ ...BASE_ORDER, invoice_number: null } as any)
    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ error: 'Invoice not generated yet' })
  })

  it('returns 409 when e-way bill already generated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValueOnce({ ...BASE_ORDER, eway_bill_no: 'EWB99' } as any)
    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'E-way bill already generated', ewbNo: 'EWB99' })
  })

  it('returns parseBody error response when body is invalid', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValueOnce(BASE_ORDER as any)
    vi.mocked(queryMany)
      .mockResolvedValueOnce(ORDER_ITEMS as any)
      .mockResolvedValueOnce(SETTINGS_ROWS as any)
    vi.mocked(parseBody).mockReturnValue({ ok: false, response: Response.json({ error: 'bad' }, { status: 422 }) } as any)
    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(422)
  })

  it('generates e-way bill and returns ewbNo on success', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne)
      .mockResolvedValueOnce(BASE_ORDER as any)     // order fetch
      .mockResolvedValueOnce(undefined as any)       // UPDATE return
    vi.mocked(queryMany)
      .mockResolvedValueOnce(ORDER_ITEMS as any)     // items
      .mockResolvedValueOnce(SETTINGS_ROWS as any)   // settings
    vi.mocked(parseBody).mockReturnValue({ ok: true, data: {} } as any)
    vi.mocked(generateEWayBill).mockResolvedValue(EWB_RESULT as any)
    vi.mocked(isEWayBillConfigured).mockReturnValue(true)
    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ewbNo).toBe('EWB12345')
    expect(body.success).toBe(true)
    expect(body.configured).toBe(true)
  })

  it('builds IGST payload when order.is_igst is true', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ ...BASE_ORDER, is_igst: true, igst_amount: '180' } as any)
      .mockResolvedValueOnce(undefined as any)
    vi.mocked(queryMany)
      .mockResolvedValueOnce(ORDER_ITEMS as any)
      .mockResolvedValueOnce(SETTINGS_ROWS as any)
    vi.mocked(parseBody).mockReturnValue({ ok: true, data: { transMode: '2', transDistance: 50, vehicleNo: 'TN01AB1234' } } as any)
    vi.mocked(generateEWayBill).mockResolvedValue(EWB_RESULT as any)
    vi.mocked(isEWayBillConfigured).mockReturnValue(false)
    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(200)
    const payload = vi.mocked(generateEWayBill).mock.calls[0][0]
    expect(payload.items[0].igstRate).toBe(18)
    expect(payload.items[0].cgstRate).toBe(0)
    expect(payload.items[0].sgstRate).toBe(0)
  })

  it('returns 500 on unexpected error', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockRejectedValue(new Error('db down'))
    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: 'db down' })
  })
})
