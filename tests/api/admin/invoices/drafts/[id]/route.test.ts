import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/gst', () => ({
  isInterState: vi.fn(),
  calculateGST: vi.fn(),
}))

vi.mock('@/lib/pricing', () => ({
  lineItemFromMrpIncl: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Import handlers AFTER mocks
// ---------------------------------------------------------------------------

import { GET, PATCH, DELETE } from '@/app/api/admin/invoices/drafts/[id]/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany, withTransaction } from '@/lib/db'
import { isInterState, calculateGST } from '@/lib/gst'
import { lineItemFromMrpIncl } from '@/lib/pricing'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN = { adminId: 'admin-1', id: 'admin-1', role: 'super_admin', scopes: ['invoices'] }
const DRAFT_ID = '550e8400-e29b-41d4-a716-446655440001'

function makeReq(method = 'GET', body?: unknown) {
  const opts: RequestInit = { method }
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' }
    opts.body = JSON.stringify(body)
  }
  return new NextRequest(new Request(`http://localhost/api/admin/invoices/drafts/${DRAFT_ID}`, opts))
}

const DRAFT_ORDER = { id: DRAFT_ID, status: 'draft' }

const VALID_PATCH_BODY = {
  customerName: 'Draft Customer',
  customerPhone: '9876543210',
  customerEmail: 'draft@example.com',
  addressLine1: '1 Draft St',
  addressLine2: null,
  city: 'Chennai',
  state: 'Tamil Nadu',
  postalCode: '600001',
  buyerGstin: null,
  paymentMode: 'cash',
  notes: null,
  items: [
    {
      product_id: null,
      product_name: 'Draft Item',
      product_sku: 'DFT',
      variant_id: null,
      sub_variant_id: null,
      unit_price: '50',
      quantity: '1',
      gst_rate: '18',
      discount_pct: '0',
    },
  ],
}

function makeTransactionClient() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  }
}

// ---------------------------------------------------------------------------
// GET tests
// ---------------------------------------------------------------------------

describe('GET /api/admin/invoices/drafts/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue({
      ...DRAFT_ORDER,
      address_line1: '1 Draft St',
      city: 'Chennai',
      state: 'Tamil Nadu',
      postal_code: '600001',
    } as any)
    vi.mocked(queryMany).mockResolvedValue([{ id: 'item-1', product_name: 'Draft Item' }] as any)
  })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await GET(makeReq(), { params: { id: DRAFT_ID } })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await GET(makeReq(), { params: { id: DRAFT_ID } })
    expect(res.status).toBe(403)
  })

  it('returns 404 when draft not found', async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any)
    const res = await GET(makeReq(), { params: { id: DRAFT_ID } })
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe('Draft not found')
  })

  it('returns order and items on happy path', async () => {
    const res = await GET(makeReq(), { params: { id: DRAFT_ID } })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).toHaveProperty('order')
    expect(json).toHaveProperty('items')
    expect(json.items).toHaveLength(1)
  })

  it('returns 500 on DB error', async () => {
    vi.mocked(queryOne).mockRejectedValue(new Error('DB down'))
    const res = await GET(makeReq(), { params: { id: DRAFT_ID } })
    expect(res.status).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// PATCH tests
// ---------------------------------------------------------------------------

describe('PATCH /api/admin/invoices/drafts/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue(DRAFT_ORDER as any)
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(makeTransactionClient()))
    // Re-setup lib mocks cleared by resetAllMocks
    vi.mocked(isInterState).mockReturnValue(false)
    vi.mocked(calculateGST).mockReturnValue({ taxableAmount: 84.75, cgst: 7.63, sgst: 7.63, igst: 0 } as any)
    vi.mocked(lineItemFromMrpIncl).mockReturnValue(100)
  })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await PATCH(makeReq('PATCH', VALID_PATCH_BODY), { params: { id: DRAFT_ID } })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await PATCH(makeReq('PATCH', VALID_PATCH_BODY), { params: { id: DRAFT_ID } })
    expect(res.status).toBe(403)
  })

  it('returns 404 when draft not found', async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any)
    const res = await PATCH(makeReq('PATCH', VALID_PATCH_BODY), { params: { id: DRAFT_ID } })
    expect(res.status).toBe(404)
  })

  it('returns 400 when order is not a draft', async () => {
    vi.mocked(queryOne).mockResolvedValue({ id: DRAFT_ID, status: 'invoiced' } as any)
    const res = await PATCH(makeReq('PATCH', VALID_PATCH_BODY), { params: { id: DRAFT_ID } })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/draft/)
  })

  it('returns 400 when customerName is missing', async () => {
    const body = { ...VALID_PATCH_BODY, customerName: '' }
    const res = await PATCH(makeReq('PATCH', body), { params: { id: DRAFT_ID } })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/customerName/)
  })

  it('updates draft and returns success', async () => {
    const res = await PATCH(makeReq('PATCH', VALID_PATCH_BODY), { params: { id: DRAFT_ID } })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
  })

  it('handles empty items array (clears line items)', async () => {
    const body = { ...VALID_PATCH_BODY, items: [] }
    const res = await PATCH(makeReq('PATCH', body), { params: { id: DRAFT_ID } })
    expect(res.status).toBe(200)
  })

  it('sets payment_status to unpaid when paymentMode is credit', async () => {
    const body = { ...VALID_PATCH_BODY, paymentMode: 'credit' }
    const client = makeTransactionClient()
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(client))

    const res = await PATCH(makeReq('PATCH', body), { params: { id: DRAFT_ID } })
    expect(res.status).toBe(200)
    // Verify query was called with 'unpaid'
    const updateCall = client.query.mock.calls.find((args: any[]) =>
      typeof args[0] === 'string' && args[0].includes('UPDATE orders'),
    )
    expect(updateCall).toBeDefined()
    expect(updateCall![1]).toContain('unpaid')
  })

  it('uses IGST when buyer has GSTIN and is inter-state', async () => {
    const { isInterState } = await import('@/lib/gst')
    vi.mocked(isInterState).mockReturnValue(true)

    const body = { ...VALID_PATCH_BODY, buyerGstin: '27AABCU9603R1ZM', state: 'Maharashtra' }
    const res = await PATCH(makeReq('PATCH', body), { params: { id: DRAFT_ID } })
    expect(res.status).toBe(200)
  })

  it('returns 500 on transaction failure', async () => {
    vi.mocked(withTransaction).mockRejectedValue(new Error('TX error'))
    const res = await PATCH(makeReq('PATCH', VALID_PATCH_BODY), { params: { id: DRAFT_ID } })
    expect(res.status).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// DELETE tests
// ---------------------------------------------------------------------------

describe('DELETE /api/admin/invoices/drafts/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue(DRAFT_ORDER as any)
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(makeTransactionClient()))
  })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await DELETE(makeReq('DELETE'), { params: { id: DRAFT_ID } })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await DELETE(makeReq('DELETE'), { params: { id: DRAFT_ID } })
    expect(res.status).toBe(403)
  })

  it('returns 404 when draft not found', async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any)
    const res = await DELETE(makeReq('DELETE'), { params: { id: DRAFT_ID } })
    expect(res.status).toBe(404)
  })

  it('returns 400 when order is not a draft', async () => {
    vi.mocked(queryOne).mockResolvedValue({ id: DRAFT_ID, status: 'invoiced' } as any)
    const res = await DELETE(makeReq('DELETE'), { params: { id: DRAFT_ID } })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/draft/)
  })

  it('deletes draft and returns success', async () => {
    const res = await DELETE(makeReq('DELETE'), { params: { id: DRAFT_ID } })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
  })

  it('runs all 3 DELETE queries inside transaction', async () => {
    const client = makeTransactionClient()
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(client))

    await DELETE(makeReq('DELETE'), { params: { id: DRAFT_ID } })

    const deleteCalls = client.query.mock.calls.filter(
      (args: any[]) => typeof args[0] === 'string' && args[0].trim().startsWith('DELETE'),
    )
    expect(deleteCalls.length).toBeGreaterThanOrEqual(3)
  })

  it('returns 500 on transaction failure', async () => {
    vi.mocked(withTransaction).mockRejectedValue(new Error('TX error'))
    const res = await DELETE(makeReq('DELETE'), { params: { id: DRAFT_ID } })
    expect(res.status).toBe(500)
  })
})
