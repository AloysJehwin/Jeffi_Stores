import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/auth/scopes', () => ({
  hasScope: vi.fn(),
}))

// Transaction client: canned rows keyed on SQL, mutable per test.
const tx = vi.hoisted(() => ({ qt: null as any, updated: null as any, items: [] as any[] }))
const txQuery = vi.hoisted(() => vi.fn())

vi.mock('@/lib/shared/db', () => ({
  queryMany: vi.fn(),
  queryOne: vi.fn(),
  query: vi.fn(),
  withTransaction: vi.fn(async (cb: any) => cb({ query: txQuery })),
}))

vi.mock('@/lib/catalog/site-controls', () => ({
  getFeatureFlags: vi.fn(async () => ({ gstEnabled: true })),
}))

vi.mock('@/lib/catalog/search', () => ({
  buildVectorSearchClause: vi.fn(),
}))

vi.mock('@/lib/email', () => ({
  sendQuotationFinalizedEmail: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { GET as quotationsGET, POST as quotationsPOST } from '@/app/api/(admin)/admin/quotations/route'
import {
  GET as quotationByIdGET,
  PATCH as quotationByIdPATCH,
  DELETE as quotationByIdDELETE,
} from '@/app/api/(admin)/admin/quotations/[id]/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany, queryOne, query } from '@/lib/shared/db'
import { buildVectorSearchClause } from '@/lib/catalog/search'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN = { adminId: 'admin-1', role: 'super_admin', scopes: ['quotations'] }
const QUOTE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

function resetTx() {
  tx.qt = null
  tx.updated = null
  tx.items = []
  txQuery.mockReset()
  txQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('INSERT INTO quotations')) return { rows: [tx.qt] }
    if (sql.includes('UPDATE quotations')) return { rows: [tx.updated] }
    if (sql.includes('SELECT * FROM quotation_items')) return { rows: tx.items }
    return { rows: [] }
  })
}

/** Params of each INSERT INTO quotation_items run on the transaction client. */
function itemInserts(): any[][] {
  return txQuery.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO quotation_items')).map(c => c[1])
}

// quotation_items INSERT param positions
const P = { gst_rate: 4, unit: 6, sold_unit_factor: 8, base_quantity: 9, rate: 10, amount: 12, product_id: 13 }
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111'

function makeReq(url: string) {
  return new NextRequest(new Request(url))
}

function jsonReq(url: string, body: unknown, method = 'POST') {
  return new NextRequest(
    new Request(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )
}

function patchReq(url: string, body: unknown) {
  return jsonReq(url, body, 'PATCH')
}

function deleteReq(url: string) {
  return new NextRequest(new Request(url, { method: 'DELETE' }))
}

const SAMPLE_ITEM = {
  description: 'Bolt M6',
  quantity: 10,
  rate: 50,
  gst_rate: 18,
  unit: 'PCS',
  discount_pct: 0,
}

// ---------------------------------------------------------------------------
// GET /api/admin/quotations (list)
// ---------------------------------------------------------------------------

describe('GET /api/admin/quotations', () => {
  beforeEach(() => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(buildVectorSearchClause).mockReturnValue({ clause: 'TRUE', params: [], nextIdx: 2 })
    vi.mocked(queryOne).mockResolvedValue({ total: '3' } as any)
    vi.mocked(queryMany).mockResolvedValue([
      { id: 'q1', quote_number: 'QT/24-25/JAN/1', status: 'draft' },
      { id: 'q2', quote_number: 'QT/24-25/JAN/2', status: 'final' },
      { id: 'q3', quote_number: 'QT/24-25/JAN/3', status: 'draft' },
    ] as any)
  })

  it('returns paginated quotations list', async () => {
    const res = await quotationsGET(makeReq('http://localhost/api/admin/quotations'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toMatchObject({ quotations: expect.any(Array), total: 3, page: 1 })
    expect(json.quotations).toHaveLength(3)
  })

  it('respects page and pageSize params', async () => {
    vi.mocked(queryMany).mockResolvedValue([] as any)
    vi.mocked(queryOne).mockResolvedValue({ total: '0' } as any)

    const res = await quotationsGET(makeReq('http://localhost/api/admin/quotations?page=2&pageSize=10'))
    const json = await res.json()

    expect(json.page).toBe(2)
    expect(json.pageSize).toBe(10)
  })

  it('applies status filter', async () => {
    vi.mocked(queryMany).mockResolvedValue([] as any)
    vi.mocked(queryOne).mockResolvedValue({ total: '0' } as any)

    await quotationsGET(makeReq('http://localhost/api/admin/quotations?status=draft'))

    expect(queryOne).toHaveBeenCalled()
    const countCall = vi.mocked(queryOne).mock.calls[0]
    expect(countCall[1]).toContain('draft')
  })

  it('applies date range filters (from + to)', async () => {
    vi.mocked(queryMany).mockResolvedValue([] as any)
    vi.mocked(queryOne).mockResolvedValue({ total: '0' } as any)

    const res = await quotationsGET(makeReq('http://localhost/api/admin/quotations?from=2024-01-01&to=2024-03-31'))
    expect(res.status).toBe(200)
    const countCall = vi.mocked(queryOne).mock.calls[0]
    expect(countCall[1]).toEqual(expect.arrayContaining(['2024-01-01', '2024-03-31']))
  })

  it('applies text search via buildVectorSearchClause', async () => {
    vi.mocked(queryMany).mockResolvedValue([] as any)
    vi.mocked(queryOne).mockResolvedValue({ total: '0' } as any)
    vi.mocked(buildVectorSearchClause).mockReturnValue({
      clause: 'search_vector @@ to_tsquery($1)',
      params: ['bolt'],
      nextIdx: 2,
    })

    const res = await quotationsGET(makeReq('http://localhost/api/admin/quotations?q=bolt'))
    expect(res.status).toBe(200)
    expect(buildVectorSearchClause).toHaveBeenCalledWith(
      'bolt',
      'search_vector',
      expect.any(Array),
      expect.any(Array),
      expect.any(Number),
      'simple'
    )
  })

  it('applies all filters combined (status + q + from + to)', async () => {
    vi.mocked(queryMany).mockResolvedValue([] as any)
    vi.mocked(queryOne).mockResolvedValue({ total: '0' } as any)
    vi.mocked(buildVectorSearchClause).mockReturnValue({ clause: 'TRUE', params: [], nextIdx: 3 })

    const res = await quotationsGET(
      makeReq('http://localhost/api/admin/quotations?status=final&q=acme&from=2024-01-01&to=2024-12-31')
    )
    expect(res.status).toBe(200)
    expect(queryOne).toHaveBeenCalled()
  })

  it('applies whitelisted sort column (total_amount asc)', async () => {
    vi.mocked(queryMany).mockResolvedValue([] as any)
    vi.mocked(queryOne).mockResolvedValue({ total: '0' } as any)

    const res = await quotationsGET(makeReq('http://localhost/api/admin/quotations?sort=total_amount&dir=asc'))
    expect(res.status).toBe(200)
    const dataCall = vi.mocked(queryMany).mock.calls[0]
    expect(dataCall[0]).toContain('total_amount ASC')
  })

  it('ignores unknown sort column and falls back to created_at DESC', async () => {
    vi.mocked(queryMany).mockResolvedValue([] as any)
    vi.mocked(queryOne).mockResolvedValue({ total: '0' } as any)

    const res = await quotationsGET(makeReq('http://localhost/api/admin/quotations?sort=injected_col&dir=desc'))
    expect(res.status).toBe(200)
    const dataCall = vi.mocked(queryMany).mock.calls[0]
    expect(dataCall[0]).toContain('ORDER BY created_at DESC')
    expect(dataCall[0]).not.toContain('injected_col')
  })

  it('caps pageSize at 200', async () => {
    vi.mocked(queryMany).mockResolvedValue([] as any)
    vi.mocked(queryOne).mockResolvedValue({ total: '0' } as any)

    const res = await quotationsGET(makeReq('http://localhost/api/admin/quotations?pageSize=9999'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.pageSize).toBe(200)
  })

  it('treats page < 1 as page 1', async () => {
    vi.mocked(queryMany).mockResolvedValue([] as any)
    vi.mocked(queryOne).mockResolvedValue({ total: '0' } as any)

    const res = await quotationsGET(makeReq('http://localhost/api/admin/quotations?page=0'))
    const json = await res.json()
    expect(json.page).toBe(1)
  })

  it('handles null total from count query gracefully', async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any)
    vi.mocked(queryMany).mockResolvedValue([] as any)

    const res = await quotationsGET(makeReq('http://localhost/api/admin/quotations'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.total).toBe(0)
  })

  it('returns 500 on db error', async () => {
    vi.mocked(queryOne).mockRejectedValue(new Error('PG timeout'))
    const res = await quotationsGET(makeReq('http://localhost/api/admin/quotations'))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('PG timeout')
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await quotationsGET(makeReq('http://localhost/api/admin/quotations'))
    expect(res.status).toBe(401)
  })

  it('returns 403 when quotations scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await quotationsGET(makeReq('http://localhost/api/admin/quotations'))
    expect(res.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// POST /api/admin/quotations (create)
// ---------------------------------------------------------------------------

describe('POST /api/admin/quotations', () => {
  const newQuote = { id: 'new-qt', quote_number: 'QT/24-25/JAN/1', status: 'draft', total_amount: 590 }

  beforeEach(() => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockReset()
    vi.mocked(query).mockReset()
    vi.mocked(queryMany).mockReset()
    resetTx()
    vi.mocked(queryOne).mockResolvedValue({ max_seq: null } as any)
    tx.qt = newQuote
    tx.items = [SAMPLE_ITEM]
  })

  function post(body: unknown) {
    return quotationsPOST(jsonReq('http://localhost/api/admin/quotations', body))
  }

  it('creates quotation with line items and returns 201', async () => {
    const res = await post({ consignee_name: 'Acme Corp', consignee_email: 'buyer@acme.com', items: [SAMPLE_ITEM] })
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json).toHaveProperty('quotation')
    expect(json).toHaveProperty('items')
    expect(itemInserts()).toHaveLength(1)
  })

  it('returns 400 when consignee_name is missing', async () => {
    const res = await post({ items: [SAMPLE_ITEM] })
    expect(res.status).toBe(400)
  })

  it('returns 400 when items array is empty', async () => {
    const res = await post({ consignee_name: 'Acme Corp', items: [] })
    expect(res.status).toBe(400)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await post({ consignee_name: 'Acme Corp', items: [SAMPLE_ITEM] })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await post({ consignee_name: 'Acme Corp', items: [SAMPLE_ITEM] })
    expect(res.status).toBe(403)
  })

  it('returns 500 on db error', async () => {
    vi.mocked(queryOne).mockRejectedValue(new Error('DB connection lost'))
    const res = await post({ consignee_name: 'Acme Corp', items: [SAMPLE_ITEM] })
    expect(res.status).toBe(500)
  })

  it('increments sequence when prior quotes exist in month (max_seq > 0)', async () => {
    vi.mocked(queryOne).mockResolvedValue({ max_seq: '5' } as any)
    tx.qt = { id: 'new-qt', quote_number: 'QT/24-25/JAN/6', status: 'draft' }

    const res = await post({ consignee_name: 'Acme Corp', items: [SAMPLE_ITEM] })
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.quotation.quote_number).toContain('/6')
    const insert = txQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO quotations'))
    expect(String(insert![1][0])).toMatch(/\/6$/)
  })

  it('stores buyer_same=false and buyer address fields', async () => {
    const res = await post({
      consignee_name: 'Consignee Ltd',
      buyer_same: false,
      buyer_name: 'Buyer Corp',
      buyer_addr1: '12 Park St',
      buyer_city: 'Delhi',
      buyer_state: 'Delhi',
      buyer_gstin: '07AABCU9603R1ZP',
      items: [SAMPLE_ITEM],
    })
    expect(res.status).toBe(201)
    const insert = txQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO quotations'))
    expect(insert).toBeDefined()
    expect(insert![1]).toEqual(expect.arrayContaining([false, 'Buyer Corp', '12 Park St']))
  })

  it('computes amount server-side (qty × rate × (1 − disc)) and totals', async () => {
    const res = await post({ consignee_name: 'Acme Corp', items: [{ ...SAMPLE_ITEM, discount_pct: 10 }] })
    expect(res.status).toBe(201)
    expect(itemInserts()[0][P.amount]).toBeCloseTo(450) // 10 × 50 × 0.9
    const insert = txQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO quotations'))
    const params = insert![1] as any[]
    // subtotal, cgst, sgst, total are params 22..25 (0-based)
    expect(params[22]).toBeCloseTo(450)
    expect(params[25]).toBeCloseTo(531)
  })

  it('ignores a client-supplied amount', async () => {
    const res = await post({ consignee_name: 'Acme Corp', items: [{ ...SAMPLE_ITEM, amount: 999 }] })
    expect(res.status).toBe(201)
    expect(itemInserts()[0][P.amount]).toBeCloseTo(500)
  })

  it('persists sold_unit_factor/base_quantity and scales amount for a product count unit', async () => {
    const res = await post({
      consignee_name: 'Acme Corp',
      items: [{ ...SAMPLE_ITEM, quantity: 2, rate: 5, product_id: PRODUCT_ID, sell_unit_factor: 10, buy_unit: 'SET' }],
    })
    expect(res.status).toBe(201)
    const params = itemInserts()[0]
    expect(params[P.sold_unit_factor]).toBe(10)
    expect(params[P.base_quantity]).toBe(20)
    expect(params[P.amount]).toBeCloseTo(100) // 2 SET × 10 pcs × ₹5
  })

  it('does not apply the factor for a non-count unit', async () => {
    const res = await post({
      consignee_name: 'Acme Corp',
      items: [{ ...SAMPLE_ITEM, product_id: PRODUCT_ID, sell_unit_factor: 1000, sell_unit_dimension: 'weight' }],
    })
    expect(res.status).toBe(201)
    expect(itemInserts()[0][P.sold_unit_factor]).toBeNull()
    expect(itemInserts()[0][P.amount]).toBeCloseTo(500)
  })

  it('accepts a custom line (product_id null) with NULL factor', async () => {
    const res = await post({
      consignee_name: 'Acme Corp',
      items: [{ ...SAMPLE_ITEM, description: 'Installation', unit: 'job', product_id: null, sell_unit_factor: 10 }],
    })
    expect(res.status).toBe(201)
    const params = itemInserts()[0]
    expect(params[P.product_id]).toBeNull()
    expect(params[P.sold_unit_factor]).toBeNull()
    expect(params[P.base_quantity]).toBeNull()
    expect(params[P.unit]).toBe('JOB')
    expect(params[P.amount]).toBeCloseTo(500)
  })

  it('returns 400 for a custom line with rate 0', async () => {
    const res = await post({ consignee_name: 'Acme Corp', items: [{ ...SAMPLE_ITEM, rate: 0 }] })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.fields['items.0.rate']).toMatch(/greater than 0/)
    expect(itemInserts()).toHaveLength(0)
  })

  it('returns 400 for a custom line whose unit is longer than 10 characters', async () => {
    const res = await post({ consignee_name: 'Acme Corp', items: [{ ...SAMPLE_ITEM, unit: 'CONTAINERS1' }] })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.fields['items.0.unit']).toMatch(/10 characters/)
  })

  it('returns 400 for a blank item name or zero quantity', async () => {
    const res = await post({ consignee_name: 'Acme Corp', items: [{ ...SAMPLE_ITEM, description: ' ', quantity: 0 }] })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.fields['items.0.description']).toBeDefined()
    expect(json.fields['items.0.quantity']).toBeDefined()
  })

  it('returns 400 when GST % is out of range', async () => {
    const res = await post({ consignee_name: 'Acme Corp', items: [{ ...SAMPLE_ITEM, gst_rate: 55 }] })
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// GET /api/admin/quotations/[id]
// ---------------------------------------------------------------------------

describe('GET /api/admin/quotations/[id]', () => {
  beforeEach(() => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockReset()
    vi.mocked(queryMany).mockReset()
  })

  it('returns quotation with items when found', async () => {
    vi.mocked(queryOne).mockResolvedValue({ id: QUOTE_ID, quote_number: 'QT/24-25/JAN/1', status: 'draft' } as any)
    vi.mocked(queryMany).mockResolvedValue([SAMPLE_ITEM] as any)

    const res = await quotationByIdGET(makeReq(`http://localhost/api/admin/quotations/${QUOTE_ID}`), {
      params: Promise.resolve({ id: QUOTE_ID }),
    })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toMatchObject({ quotation: { id: QUOTE_ID }, items: expect.any(Array) })
  })

  it('returns 404 when quotation not found', async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any)

    const res = await quotationByIdGET(makeReq(`http://localhost/api/admin/quotations/${QUOTE_ID}`), {
      params: Promise.resolve({ id: QUOTE_ID }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)

    const res = await quotationByIdGET(makeReq(`http://localhost/api/admin/quotations/${QUOTE_ID}`), {
      params: Promise.resolve({ id: QUOTE_ID }),
    })
    expect(res.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// PATCH /api/admin/quotations/[id]
// ---------------------------------------------------------------------------

describe('PATCH /api/admin/quotations/[id]', () => {
  const existing = { id: QUOTE_ID, status: 'draft', subtotal: 0, cgst_amount: 0, sgst_amount: 0, total_amount: 590 }
  const updated = { ...existing, status: 'final', consignee_email: 'buyer@acme.com', quote_number: 'QT/24-25/JAN/1' }

  beforeEach(() => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockReset()
    vi.mocked(query).mockReset()
    vi.mocked(queryMany).mockReset()
    resetTx()
  })

  function patch(body: unknown) {
    return quotationByIdPATCH(patchReq(`http://localhost/api/admin/quotations/${QUOTE_ID}`, body), {
      params: Promise.resolve({ id: QUOTE_ID }),
    })
  }

  it('updates quotation status', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(existing as any)
    tx.updated = { ...updated, consignee_email: null }
    vi.mocked(queryMany).mockResolvedValue([SAMPLE_ITEM] as any)

    const res = await patch({ status: 'final' })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toHaveProperty('quotation')
    // No items in the body ⇒ lines untouched
    expect(itemInserts()).toHaveLength(0)
  })

  it('returns 404 when quotation not found', async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any)
    const res = await patch({ status: 'final' })
    expect(res.status).toBe(404)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await patch({})
    expect(res.status).toBe(401)
  })

  it('returns 403 when quotations:write scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await patch({ status: 'final' })
    expect(res.status).toBe(403)
  })

  it('recomputes totals and replaces items in one transaction when items array is provided', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ ...existing, total_amount: 0 } as any)
    tx.updated = { ...updated, total_amount: 590, consignee_email: null }
    vi.mocked(queryMany).mockResolvedValue([SAMPLE_ITEM] as any)

    const res = await patch({ status: 'draft', items: [SAMPLE_ITEM] })
    expect(res.status).toBe(200)
    const sqls = txQuery.mock.calls.map(([sql]) => String(sql))
    const del = sqls.findIndex(q => q.includes('DELETE FROM quotation_items'))
    const ins = sqls.findIndex(q => q.includes('INSERT INTO quotation_items'))
    const upd = sqls.findIndex(q => q.includes('UPDATE quotations'))
    expect(del).toBeGreaterThanOrEqual(0)
    expect(ins).toBeGreaterThan(del)
    expect(upd).toBeGreaterThan(ins)
    // subtotal 500 + 18% GST
    const updParams = txQuery.mock.calls[upd][1] as any[]
    expect(updParams).toEqual(expect.arrayContaining([500, 590]))
  })

  it('keeps a 0% GST rate as 0 (not 18)', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(existing as any)
    tx.updated = { ...updated, consignee_email: null }
    vi.mocked(queryMany).mockResolvedValue([] as any)

    const res = await patch({ items: [{ ...SAMPLE_ITEM, gst_rate: 0 }] })
    expect(res.status).toBe(200)
    expect(itemInserts()[0][P.gst_rate]).toBe(0)
  })

  it('returns 400 with field messages for an invalid line', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(existing as any)
    const res = await patch({ items: [{ ...SAMPLE_ITEM, quantity: -1 }] })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.fields['items.0.quantity']).toBeDefined()
    expect(txQuery).not.toHaveBeenCalled()
  })

  it('returns 409 when changing items on a converted quotation', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ ...existing, converted_order_id: 'ord-1' } as any)
    const res = await patch({ items: [SAMPLE_ITEM] })
    expect(res.status).toBe(409)
    expect(txQuery).not.toHaveBeenCalled()
  })

  it('recomputes totals from existing db items when no items provided and stored total is 0', async () => {
    const zeroTotal = { ...existing, subtotal: 0, total_amount: 0, cgst_amount: 0, sgst_amount: 0 }
    vi.mocked(queryOne).mockResolvedValueOnce(zeroTotal as any)
    tx.updated = { ...updated, total_amount: 590, consignee_email: null }
    vi.mocked(queryMany)
      .mockResolvedValueOnce([{ amount: 500, gst_rate: 18 }] as any) // existing items for recompute
      .mockResolvedValueOnce([SAMPLE_ITEM] as any) // savedItems after update

    const res = await patch({ status: 'draft' })
    expect(res.status).toBe(200)
    const upd = txQuery.mock.calls.find(([sql]) => String(sql).includes('UPDATE quotations'))
    expect(upd![1]).toEqual(expect.arrayContaining([500, 590]))
  })

  it('sends finalized email when status is final and consignee_email is set', async () => {
    const { sendQuotationFinalizedEmail } = await import('@/lib/email')
    vi.mocked(queryOne).mockResolvedValueOnce(existing as any)
    tx.updated = {
      ...updated,
      status: 'final',
      consignee_email: 'buyer@acme.com',
      consignee_name: 'Acme Corp',
      quote_number: 'QT/24-25/JAN/1',
      total_amount: 590,
      view_token: 'tok-abc',
    }
    vi.mocked(queryMany).mockResolvedValue([SAMPLE_ITEM] as any)

    const res = await patch({ status: 'final' })
    expect(res.status).toBe(200)
    expect(sendQuotationFinalizedEmail).toHaveBeenCalledWith(
      'buyer@acme.com',
      'Acme Corp',
      'QT/24-25/JAN/1',
      590,
      expect.stringContaining('tok-abc')
    )
  })

  it('does NOT send email when status is final but consignee_email is absent', async () => {
    const { sendQuotationFinalizedEmail } = await import('@/lib/email')
    vi.mocked(sendQuotationFinalizedEmail).mockClear()
    vi.mocked(queryOne).mockResolvedValueOnce(existing as any)
    tx.updated = { ...updated, status: 'final', consignee_email: null }
    vi.mocked(queryMany).mockResolvedValue([SAMPLE_ITEM] as any)

    const res = await patch({ status: 'final' })
    expect(res.status).toBe(200)
    expect(sendQuotationFinalizedEmail).not.toHaveBeenCalled()
  })

  it('returns 500 on db error', async () => {
    vi.mocked(queryOne).mockRejectedValue(new Error('DB timeout'))
    const res = await patch({ status: 'draft' })
    expect(res.status).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// DELETE /api/admin/quotations/[id]
// ---------------------------------------------------------------------------

describe('DELETE /api/admin/quotations/[id]', () => {
  beforeEach(() => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockReset()
    vi.mocked(query).mockReset()
  })

  it('deletes a draft quotation', async () => {
    vi.mocked(queryOne).mockResolvedValue({ id: QUOTE_ID, status: 'draft' } as any)
    vi.mocked(query).mockResolvedValue(undefined as any)

    const res = await quotationByIdDELETE(deleteReq(`http://localhost/api/admin/quotations/${QUOTE_ID}`), {
      params: Promise.resolve({ id: QUOTE_ID }),
    })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ ok: true })
  })

  it('returns 404 when quotation does not exist', async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any)

    const res = await quotationByIdDELETE(deleteReq(`http://localhost/api/admin/quotations/${QUOTE_ID}`), {
      params: Promise.resolve({ id: QUOTE_ID }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 400 when trying to delete a finalised quotation', async () => {
    vi.mocked(queryOne).mockResolvedValue({ id: QUOTE_ID, status: 'final' } as any)

    const res = await quotationByIdDELETE(deleteReq(`http://localhost/api/admin/quotations/${QUOTE_ID}`), {
      params: Promise.resolve({ id: QUOTE_ID }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)

    const res = await quotationByIdDELETE(deleteReq(`http://localhost/api/admin/quotations/${QUOTE_ID}`), {
      params: Promise.resolve({ id: QUOTE_ID }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when quotations:write scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    vi.mocked(queryOne).mockResolvedValue({ id: QUOTE_ID, status: 'draft' } as any)

    const res = await quotationByIdDELETE(deleteReq(`http://localhost/api/admin/quotations/${QUOTE_ID}`), {
      params: Promise.resolve({ id: QUOTE_ID }),
    })
    expect(res.status).toBe(403)
  })

  it('returns 409 when a FK violation occurs (RFQ linked quotation)', async () => {
    vi.mocked(queryOne).mockResolvedValue({ id: QUOTE_ID, status: 'draft' } as any)
    // First query() is the RFQ detach UPDATE, second is the DELETE — simulate FK error on the DELETE
    vi.mocked(query)
      .mockResolvedValueOnce(undefined as any) // detach RFQ UPDATE succeeds
      .mockRejectedValueOnce(Object.assign(new Error('FK violation'), { code: '23503' }))

    const res = await quotationByIdDELETE(deleteReq(`http://localhost/api/admin/quotations/${QUOTE_ID}`), {
      params: Promise.resolve({ id: QUOTE_ID }),
    })
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toMatch(/RFQ/i)
  })

  it('returns 500 on unexpected db error during delete', async () => {
    vi.mocked(queryOne).mockResolvedValue({ id: QUOTE_ID, status: 'draft' } as any)
    vi.mocked(query).mockRejectedValue(new Error('Connection lost'))

    const res = await quotationByIdDELETE(deleteReq(`http://localhost/api/admin/quotations/${QUOTE_ID}`), {
      params: Promise.resolve({ id: QUOTE_ID }),
    })
    expect(res.status).toBe(500)
  })
})
