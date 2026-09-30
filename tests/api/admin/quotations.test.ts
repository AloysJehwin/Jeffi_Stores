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
  queryMany: vi.fn(),
  queryOne: vi.fn(),
  query: vi.fn(),
}))

vi.mock('@/lib/search', () => ({
  buildVectorSearchClause: vi.fn(),
}))

vi.mock('@/lib/email', () => ({
  sendQuotationFinalizedEmail: vi.fn(),
}))

vi.mock('@/lib/pricing', () => ({
  lineItemExGst: vi.fn((qty: number, rate: number, discount: number) => qty * rate * (1 - discount / 100)),
}))

vi.mock('@/lib/validate', () => {
  const { z } = require('zod')
  const zNonEmpty = z.string().min(1)
  const zEmail = z.string().email()
  return {
    zNonEmpty,
    zEmail,
    parseBody: vi.fn((schema: any, data: any) => {
      const result = schema.safeParse(data)
      if (result.success) return { ok: true, data: result.data }
      return {
        ok: false,
        response: Response.json({ error: result.error.issues[0]?.message ?? 'Validation error' }, { status: 400 }),
      }
    }),
  }
})

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { GET as quotationsGET, POST as quotationsPOST } from '@/app/api/admin/quotations/route'
import {
  GET as quotationByIdGET,
  PATCH as quotationByIdPATCH,
  DELETE as quotationByIdDELETE,
} from '@/app/api/admin/quotations/[id]/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany, queryOne, query } from '@/lib/db'
import { buildVectorSearchClause } from '@/lib/search'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN = { adminId: 'admin-1', role: 'super_admin', scopes: ['quotations'] }
const QUOTE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

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
  })

  it('creates quotation with line items and returns 201', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ max_seq: null } as any)
      .mockResolvedValueOnce(newQuote as any)
    vi.mocked(query).mockResolvedValue(undefined as any)
    vi.mocked(queryMany).mockResolvedValue([SAMPLE_ITEM] as any)

    const res = await quotationsPOST(
      jsonReq('http://localhost/api/admin/quotations', {
        consignee_name: 'Acme Corp',
        consignee_email: 'buyer@acme.com',
        items: [SAMPLE_ITEM],
      })
    )
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json).toHaveProperty('quotation')
    expect(json).toHaveProperty('items')
  })

  it('returns 400 when consignee_name is missing', async () => {
    const res = await quotationsPOST(
      jsonReq('http://localhost/api/admin/quotations', {
        items: [SAMPLE_ITEM],
      })
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 when items array is empty', async () => {
    const res = await quotationsPOST(
      jsonReq('http://localhost/api/admin/quotations', {
        consignee_name: 'Acme Corp',
        items: [],
      })
    )
    expect(res.status).toBe(400)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await quotationsPOST(
      jsonReq('http://localhost/api/admin/quotations', {
        consignee_name: 'Acme Corp',
        items: [SAMPLE_ITEM],
      })
    )
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await quotationsPOST(
      jsonReq('http://localhost/api/admin/quotations', {
        consignee_name: 'Acme Corp',
        items: [SAMPLE_ITEM],
      })
    )
    expect(res.status).toBe(403)
  })

  it('returns 500 on db error', async () => {
    vi.mocked(queryOne).mockRejectedValue(new Error('DB connection lost'))
    const res = await quotationsPOST(
      jsonReq('http://localhost/api/admin/quotations', {
        consignee_name: 'Acme Corp',
        items: [SAMPLE_ITEM],
      })
    )
    expect(res.status).toBe(500)
  })

  it('increments sequence when prior quotes exist in month (max_seq > 0)', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ max_seq: '5' } as any)
      .mockResolvedValueOnce({ id: 'new-qt', quote_number: 'QT/24-25/JAN/6', status: 'draft' } as any)
    vi.mocked(query).mockResolvedValue(undefined as any)
    vi.mocked(queryMany).mockResolvedValue([SAMPLE_ITEM] as any)

    const res = await quotationsPOST(
      jsonReq('http://localhost/api/admin/quotations', {
        consignee_name: 'Acme Corp',
        items: [SAMPLE_ITEM],
      })
    )
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.quotation.quote_number).toContain('/6')
  })

  it('stores buyer_same=false and buyer address fields', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ max_seq: null } as any)
      .mockResolvedValueOnce({ id: 'qt-2', quote_number: 'QT/24-25/JAN/1', status: 'draft' } as any)
    vi.mocked(query).mockResolvedValue(undefined as any)
    vi.mocked(queryMany).mockResolvedValue([SAMPLE_ITEM] as any)

    const res = await quotationsPOST(
      jsonReq('http://localhost/api/admin/quotations', {
        consignee_name: 'Consignee Ltd',
        buyer_same: false,
        buyer_name: 'Buyer Corp',
        buyer_addr1: '12 Park St',
        buyer_city: 'Delhi',
        buyer_state: 'Delhi',
        buyer_gstin: '07AABCU9603R1ZP',
        items: [SAMPLE_ITEM],
      })
    )
    expect(res.status).toBe(201)
    const insertCall = vi
      .mocked(queryOne)
      .mock.calls.find(([sql]) => (sql as string).includes('INSERT INTO quotations'))
    expect(insertCall).toBeDefined()
  })

  it('uses lineItemExGst to compute amount when item.amount is 0', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ max_seq: null } as any)
      .mockResolvedValueOnce({ id: 'qt-3', quote_number: 'QT/24-25/JAN/1', status: 'draft' } as any)
    vi.mocked(query).mockResolvedValue(undefined as any)
    vi.mocked(queryMany).mockResolvedValue([{ ...SAMPLE_ITEM, amount: 0 }] as any)

    const res = await quotationsPOST(
      jsonReq('http://localhost/api/admin/quotations', {
        consignee_name: 'Acme Corp',
        items: [{ ...SAMPLE_ITEM, amount: 0 }],
      })
    )
    expect(res.status).toBe(201)
  })

  it('uses provided amount when item.amount > 0', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ max_seq: null } as any)
      .mockResolvedValueOnce({ id: 'qt-4', quote_number: 'QT/24-25/JAN/1', status: 'draft' } as any)
    vi.mocked(query).mockResolvedValue(undefined as any)
    vi.mocked(queryMany).mockResolvedValue([{ ...SAMPLE_ITEM, amount: 450 }] as any)

    const res = await quotationsPOST(
      jsonReq('http://localhost/api/admin/quotations', {
        consignee_name: 'Acme Corp',
        items: [{ ...SAMPLE_ITEM, amount: 450 }],
      })
    )
    expect(res.status).toBe(201)
  })

  it('sets sell_unit_factor and base_quantity when sell_unit_factor > 1', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ max_seq: null } as any)
      .mockResolvedValueOnce({ id: 'qt-5', quote_number: 'QT/24-25/JAN/1', status: 'draft' } as any)
    vi.mocked(query).mockResolvedValue(undefined as any)
    vi.mocked(queryMany).mockResolvedValue([SAMPLE_ITEM] as any)

    const res = await quotationsPOST(
      jsonReq('http://localhost/api/admin/quotations', {
        consignee_name: 'Acme Corp',
        items: [{ ...SAMPLE_ITEM, sell_unit_factor: 10, buy_unit: 'BOX' }],
      })
    )
    expect(res.status).toBe(201)
    const insertItemCalls = vi
      .mocked(query)
      .mock.calls.filter(([sql]) => (sql as string).includes('INSERT INTO quotation_items'))
    expect(insertItemCalls).toHaveLength(1)
    // sold_unit_factor param should be 10
    const params = insertItemCalls[0][1] as any[]
    expect(params).toContain(10)
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
  })

  it('updates quotation status', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce(existing as any)
      .mockResolvedValueOnce(updated as any)
    vi.mocked(query).mockResolvedValue(undefined as any)
    vi.mocked(queryMany).mockResolvedValue([SAMPLE_ITEM] as any)

    const res = await quotationByIdPATCH(
      patchReq(`http://localhost/api/admin/quotations/${QUOTE_ID}`, { status: 'final' }),
      { params: Promise.resolve({ id: QUOTE_ID }) }
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toHaveProperty('quotation')
  })

  it('returns 404 when quotation not found', async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any)

    const res = await quotationByIdPATCH(
      patchReq(`http://localhost/api/admin/quotations/${QUOTE_ID}`, { status: 'final' }),
      { params: Promise.resolve({ id: QUOTE_ID }) }
    )
    expect(res.status).toBe(404)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)

    const res = await quotationByIdPATCH(patchReq(`http://localhost/api/admin/quotations/${QUOTE_ID}`, {}), {
      params: Promise.resolve({ id: QUOTE_ID }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when quotations:write scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)

    const res = await quotationByIdPATCH(
      patchReq(`http://localhost/api/admin/quotations/${QUOTE_ID}`, { status: 'final' }),
      { params: Promise.resolve({ id: QUOTE_ID }) }
    )
    expect(res.status).toBe(403)
  })

  it('recomputes totals and replaces items when items array is provided', async () => {
    const existingWithItems = { ...existing, total_amount: 0 }
    const updatedQt = { ...updated, total_amount: 590, consignee_email: null }
    vi.mocked(queryOne)
      .mockResolvedValueOnce(existingWithItems as any) // fetch existing
      .mockResolvedValueOnce(updatedQt as any) // UPDATE RETURNING
    vi.mocked(query).mockResolvedValue(undefined as any)
    vi.mocked(queryMany).mockResolvedValue([SAMPLE_ITEM] as any)

    const res = await quotationByIdPATCH(
      patchReq(`http://localhost/api/admin/quotations/${QUOTE_ID}`, {
        status: 'draft',
        items: [SAMPLE_ITEM],
      }),
      { params: Promise.resolve({ id: QUOTE_ID }) }
    )
    expect(res.status).toBe(200)
    // DELETE + INSERT per item should have been called
    const deleteCalls = vi
      .mocked(query)
      .mock.calls.filter(([sql]) => (sql as string).includes('DELETE FROM quotation_items'))
    expect(deleteCalls.length).toBeGreaterThan(0)
  })

  it('recomputes totals from existing db items when no items provided and stored total is 0', async () => {
    const zeroTotal = { ...existing, subtotal: 0, total_amount: 0, cgst_amount: 0, sgst_amount: 0 }
    const updatedQt = { ...updated, total_amount: 590, consignee_email: null }
    vi.mocked(queryOne)
      .mockResolvedValueOnce(zeroTotal as any) // fetch existing
      .mockResolvedValueOnce(updatedQt as any) // UPDATE RETURNING
    vi.mocked(queryMany)
      .mockResolvedValueOnce([{ ...SAMPLE_ITEM, amount: 500, gst_rate: 18 }] as any) // existing items for recompute
      .mockResolvedValueOnce([SAMPLE_ITEM] as any) // savedItems after update
    vi.mocked(query).mockResolvedValue(undefined as any)

    const res = await quotationByIdPATCH(
      patchReq(`http://localhost/api/admin/quotations/${QUOTE_ID}`, { status: 'draft' }),
      { params: Promise.resolve({ id: QUOTE_ID }) }
    )
    expect(res.status).toBe(200)
    // queryMany was called at least once for the existing-items recompute
    expect(queryMany).toHaveBeenCalled()
  })

  it('sends finalized email when status is final and consignee_email is set', async () => {
    const { sendQuotationFinalizedEmail } = await import('@/lib/email')
    const existingDraft = { ...existing, total_amount: 590 }
    const finalQt = {
      ...updated,
      status: 'final',
      consignee_email: 'buyer@acme.com',
      consignee_name: 'Acme Corp',
      quote_number: 'QT/24-25/JAN/1',
      total_amount: 590,
      view_token: 'tok-abc',
    }
    vi.mocked(queryOne)
      .mockResolvedValueOnce(existingDraft as any)
      .mockResolvedValueOnce(finalQt as any)
    vi.mocked(query).mockResolvedValue(undefined as any)
    vi.mocked(queryMany).mockResolvedValue([SAMPLE_ITEM] as any)

    const res = await quotationByIdPATCH(
      patchReq(`http://localhost/api/admin/quotations/${QUOTE_ID}`, { status: 'final' }),
      { params: Promise.resolve({ id: QUOTE_ID }) }
    )
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
    const existingDraft = { ...existing, total_amount: 590 }
    const finalQtNoEmail = { ...updated, status: 'final', consignee_email: null }
    vi.mocked(queryOne)
      .mockResolvedValueOnce(existingDraft as any)
      .mockResolvedValueOnce(finalQtNoEmail as any)
    vi.mocked(query).mockResolvedValue(undefined as any)
    vi.mocked(queryMany).mockResolvedValue([SAMPLE_ITEM] as any)

    const res = await quotationByIdPATCH(
      patchReq(`http://localhost/api/admin/quotations/${QUOTE_ID}`, { status: 'final' }),
      { params: Promise.resolve({ id: QUOTE_ID }) }
    )
    expect(res.status).toBe(200)
    expect(sendQuotationFinalizedEmail).not.toHaveBeenCalled()
  })

  it('returns 500 on db error', async () => {
    vi.mocked(queryOne).mockRejectedValue(new Error('DB timeout'))
    const res = await quotationByIdPATCH(
      patchReq(`http://localhost/api/admin/quotations/${QUOTE_ID}`, { status: 'draft' }),
      { params: Promise.resolve({ id: QUOTE_ID }) }
    )
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
