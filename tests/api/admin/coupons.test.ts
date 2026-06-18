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
  queryCount: vi.fn(),
}))

vi.mock('@/lib/search', () => ({
  buildSearchClause: vi.fn(),
}))

vi.mock('@/lib/validate', () => {
  const { z } = require('zod')
  const zNonEmpty = z.string().min(1)
  return {
    zNonEmpty,
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

import { GET as couponsGET, POST as couponsPOST } from '@/app/api/admin/coupons/route'
import { PATCH as couponPATCH, DELETE as couponDELETE } from '@/app/api/admin/coupons/[id]/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany, queryOne, query, queryCount } from '@/lib/db'
import { buildSearchClause } from '@/lib/search'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN = { adminId: 'admin-1', role: 'super_admin', scopes: ['coupons'] }
const COUPON_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

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

const SAMPLE_COUPON = {
  id: COUPON_ID,
  code: 'SAVE10',
  discount_type: 'percentage',
  discount_value: 10,
  is_active: true,
}

// ---------------------------------------------------------------------------
// GET /api/admin/coupons
// ---------------------------------------------------------------------------

describe('GET /api/admin/coupons', () => {
  beforeEach(() => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(buildSearchClause).mockReturnValue({ clause: 'TRUE', params: [], nextIdx: 2 })
    vi.mocked(queryMany).mockResolvedValue([SAMPLE_COUPON] as any)
    vi.mocked(queryCount).mockResolvedValue(1 as any)
  })

  it('returns coupons list with total', async () => {
    const res = await couponsGET(makeReq('http://localhost/api/admin/coupons'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toMatchObject({ coupons: expect.any(Array), total: 1 })
    expect(json.coupons[0]).toMatchObject({ code: 'SAVE10' })
  })

  it('filters by is_active=true', async () => {
    vi.mocked(queryMany).mockResolvedValue([SAMPLE_COUPON] as any)
    vi.mocked(queryCount).mockResolvedValue(1 as any)

    const res = await couponsGET(makeReq('http://localhost/api/admin/coupons?is_active=true'))
    expect(res.status).toBe(200)
  })

  it('filters by is_active=false', async () => {
    vi.mocked(queryMany).mockResolvedValue([] as any)
    vi.mocked(queryCount).mockResolvedValue(0 as any)

    const res = await couponsGET(makeReq('http://localhost/api/admin/coupons?is_active=false'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.coupons).toEqual([])
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)

    const res = await couponsGET(makeReq('http://localhost/api/admin/coupons'))
    expect(res.status).toBe(401)
  })

  it('returns 403 when coupons scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)

    const res = await couponsGET(makeReq('http://localhost/api/admin/coupons'))
    expect(res.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// POST /api/admin/coupons
// ---------------------------------------------------------------------------

describe('POST /api/admin/coupons', () => {
  beforeEach(() => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryMany).mockResolvedValue([{ ...SAMPLE_COUPON, id: 'new-id' }] as any)
  })

  it('creates a percentage coupon and returns 201', async () => {
    const res = await couponsPOST(jsonReq('http://localhost/api/admin/coupons', {
      code: 'SAVE10',
      discount_type: 'percentage',
      discount_value: 10,
    }))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json).toHaveProperty('coupon')
  })

  it('creates a flat discount coupon', async () => {
    vi.mocked(queryMany).mockResolvedValue([{ id: 'flat-id', code: 'FLAT50', discount_type: 'fixed', discount_value: 50 }] as any)

    const res = await couponsPOST(jsonReq('http://localhost/api/admin/coupons', {
      code: 'FLAT50',
      discount_type: 'fixed',
      discount_value: 50,
    }))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.coupon.discount_type).toBe('fixed')
  })

  it('stores code as uppercase', async () => {
    vi.mocked(queryMany).mockResolvedValue([{ id: 'x', code: 'LOWER10' }] as any)

    await couponsPOST(jsonReq('http://localhost/api/admin/coupons', {
      code: 'lower10',
      discount_type: 'percentage',
      discount_value: 10,
    }))

    expect(queryMany).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO coupons'),
      expect.arrayContaining(['LOWER10']),
    )
  })

  it('returns 400 when code is missing', async () => {
    const res = await couponsPOST(jsonReq('http://localhost/api/admin/coupons', {
      discount_type: 'percentage',
      discount_value: 10,
    }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when discount_type is invalid', async () => {
    const res = await couponsPOST(jsonReq('http://localhost/api/admin/coupons', {
      code: 'TEST',
      discount_type: 'invalid_type',
      discount_value: 10,
    }))
    expect(res.status).toBe(400)
  })

  it('returns 409 on duplicate coupon code', async () => {
    vi.mocked(queryMany).mockRejectedValue(Object.assign(new Error('unique violation'), { code: '23505' }))

    const res = await couponsPOST(jsonReq('http://localhost/api/admin/coupons', {
      code: 'SAVE10',
      discount_type: 'percentage',
      discount_value: 10,
    }))
    expect(res.status).toBe(409)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)

    const res = await couponsPOST(jsonReq('http://localhost/api/admin/coupons', {
      code: 'TEST',
      discount_type: 'percentage',
      discount_value: 5,
    }))
    expect(res.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// PATCH /api/admin/coupons/[id]
// ---------------------------------------------------------------------------

describe('PATCH /api/admin/coupons/[id]', () => {
  beforeEach(() => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryMany).mockResolvedValue([{ ...SAMPLE_COUPON, discount_value: 20 }] as any)
  })

  it('updates discount_value and returns 200', async () => {
    const res = await couponPATCH(
      patchReq(`http://localhost/api/admin/coupons/${COUPON_ID}`, { discount_value: 20 }),
      { params: { id: COUPON_ID } }
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toHaveProperty('coupon')
    expect(json.coupon.discount_value).toBe(20)
  })

  it('returns 400 when no fields provided', async () => {
    const res = await couponPATCH(
      patchReq(`http://localhost/api/admin/coupons/${COUPON_ID}`, {}),
      { params: { id: COUPON_ID } }
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 when coupon not found', async () => {
    vi.mocked(queryMany).mockResolvedValue([] as any)

    const res = await couponPATCH(
      patchReq(`http://localhost/api/admin/coupons/${COUPON_ID}`, { is_active: false }),
      { params: { id: COUPON_ID } }
    )
    expect(res.status).toBe(404)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)

    const res = await couponPATCH(
      patchReq(`http://localhost/api/admin/coupons/${COUPON_ID}`, { discount_value: 5 }),
      { params: { id: COUPON_ID } }
    )
    expect(res.status).toBe(401)
  })

  it('uppercases code field when updated', async () => {
    vi.mocked(queryMany).mockResolvedValue([{ ...SAMPLE_COUPON, code: 'NEWCODE' }] as any)

    await couponPATCH(
      patchReq(`http://localhost/api/admin/coupons/${COUPON_ID}`, { code: 'newcode' }),
      { params: { id: COUPON_ID } }
    )

    expect(queryMany).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE coupons'),
      expect.arrayContaining(['NEWCODE']),
    )
  })
})

// ---------------------------------------------------------------------------
// DELETE /api/admin/coupons/[id]
// ---------------------------------------------------------------------------

describe('DELETE /api/admin/coupons/[id]', () => {
  beforeEach(() => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue(null as any) // not in use
    vi.mocked(query).mockResolvedValue(undefined as any)
  })

  it('deletes coupon and returns success', async () => {
    const res = await couponDELETE(
      deleteReq(`http://localhost/api/admin/coupons/${COUPON_ID}`),
      { params: { id: COUPON_ID } }
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ success: true })
  })

  it('returns 409 when coupon is used by a review form', async () => {
    vi.mocked(queryOne).mockResolvedValue({ id: 'form-1' } as any)

    const res = await couponDELETE(
      deleteReq(`http://localhost/api/admin/coupons/${COUPON_ID}`),
      { params: { id: COUPON_ID } }
    )
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toContain('review form')
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)

    const res = await couponDELETE(
      deleteReq(`http://localhost/api/admin/coupons/${COUPON_ID}`),
      { params: { id: COUPON_ID } }
    )
    expect(res.status).toBe(401)
  })

  it('returns 403 when coupons scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)

    const res = await couponDELETE(
      deleteReq(`http://localhost/api/admin/coupons/${COUPON_ID}`),
      { params: { id: COUPON_ID } }
    )
    expect(res.status).toBe(403)
  })

  it('unlinks coupon from campaigns before deleting', async () => {
    const res = await couponDELETE(
      deleteReq(`http://localhost/api/admin/coupons/${COUPON_ID}`),
      { params: { id: COUPON_ID } }
    )

    expect(res.status).toBe(200)
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE campaigns'),
      [COUPON_ID],
    )
  })
})
