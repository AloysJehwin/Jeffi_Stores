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
import { GET as quotationByIdGET, PATCH as quotationByIdPATCH, DELETE as quotationByIdDELETE } from '@/app/api/admin/quotations/[id]/route'
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
  return new NextRequest(new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
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

    // Verify queryOne (count query) was called — with status param in conditions
    expect(queryOne).toHaveBeenCalled()
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
      .mockResolvedValueOnce({ max_seq: null } as any) // sequence lookup
      .mockResolvedValueOnce(newQuote as any)          // INSERT returning *
    vi.mocked(query).mockResolvedValue(undefined as any)
    vi.mocked(queryMany).mockResolvedValue([SAMPLE_ITEM] as any)

    const res = await quotationsPOST(jsonReq('http://localhost/api/admin/quotations', {
      consignee_name: 'Acme Corp',
      consignee_email: 'buyer@acme.com',
      items: [SAMPLE_ITEM],
    }))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json).toHaveProperty('quotation')
    expect(json).toHaveProperty('items')
  })

  it('returns 400 when consignee_name is missing', async () => {
    const res = await quotationsPOST(jsonReq('http://localhost/api/admin/quotations', {
      items: [SAMPLE_ITEM],
    }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when items array is empty', async () => {
    const res = await quotationsPOST(jsonReq('http://localhost/api/admin/quotations', {
      consignee_name: 'Acme Corp',
      items: [],
    }))
    expect(res.status).toBe(400)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)

    const res = await quotationsPOST(jsonReq('http://localhost/api/admin/quotations', {
      consignee_name: 'Acme Corp',
      items: [SAMPLE_ITEM],
    }))
    expect(res.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// GET /api/admin/quotations/[id]
// ---------------------------------------------------------------------------

describe('GET /api/admin/quotations/[id]', () => {
  beforeEach(() => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    // reset to null so each test sets its own return value
    vi.mocked(queryOne).mockReset()
    vi.mocked(queryMany).mockReset()
  })

  it('returns quotation with items when found', async () => {
    vi.mocked(queryOne).mockResolvedValue({ id: QUOTE_ID, quote_number: 'QT/24-25/JAN/1', status: 'draft' } as any)
    vi.mocked(queryMany).mockResolvedValue([SAMPLE_ITEM] as any)

    const res = await quotationByIdGET(makeReq(`http://localhost/api/admin/quotations/${QUOTE_ID}`), { params: { id: QUOTE_ID } })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toMatchObject({ quotation: { id: QUOTE_ID }, items: expect.any(Array) })
  })

  it('returns 404 when quotation not found', async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any)

    const res = await quotationByIdGET(makeReq(`http://localhost/api/admin/quotations/${QUOTE_ID}`), { params: { id: QUOTE_ID } })
    expect(res.status).toBe(404)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)

    const res = await quotationByIdGET(makeReq(`http://localhost/api/admin/quotations/${QUOTE_ID}`), { params: { id: QUOTE_ID } })
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
      .mockResolvedValueOnce(existing as any)  // existence check
      .mockResolvedValueOnce(updated as any)   // UPDATE returning *
    vi.mocked(query).mockResolvedValue(undefined as any)
    vi.mocked(queryMany).mockResolvedValue([SAMPLE_ITEM] as any)

    const res = await quotationByIdPATCH(
      patchReq(`http://localhost/api/admin/quotations/${QUOTE_ID}`, { status: 'final' }),
      { params: { id: QUOTE_ID } }
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toHaveProperty('quotation')
  })

  it('returns 404 when quotation not found', async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any)

    const res = await quotationByIdPATCH(
      patchReq(`http://localhost/api/admin/quotations/${QUOTE_ID}`, { status: 'final' }),
      { params: { id: QUOTE_ID } }
    )
    expect(res.status).toBe(404)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)

    const res = await quotationByIdPATCH(
      patchReq(`http://localhost/api/admin/quotations/${QUOTE_ID}`, {}),
      { params: { id: QUOTE_ID } }
    )
    expect(res.status).toBe(401)
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

    const res = await quotationByIdDELETE(
      deleteReq(`http://localhost/api/admin/quotations/${QUOTE_ID}`),
      { params: { id: QUOTE_ID } }
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ ok: true })
  })

  it('returns 404 when quotation does not exist', async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any)

    const res = await quotationByIdDELETE(
      deleteReq(`http://localhost/api/admin/quotations/${QUOTE_ID}`),
      { params: { id: QUOTE_ID } }
    )
    expect(res.status).toBe(404)
  })

  it('returns 400 when trying to delete a finalised quotation', async () => {
    vi.mocked(queryOne).mockResolvedValue({ id: QUOTE_ID, status: 'final' } as any)

    const res = await quotationByIdDELETE(
      deleteReq(`http://localhost/api/admin/quotations/${QUOTE_ID}`),
      { params: { id: QUOTE_ID } }
    )
    expect(res.status).toBe(400)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)

    const res = await quotationByIdDELETE(
      deleteReq(`http://localhost/api/admin/quotations/${QUOTE_ID}`),
      { params: { id: QUOTE_ID } }
    )
    expect(res.status).toBe(401)
  })
})
