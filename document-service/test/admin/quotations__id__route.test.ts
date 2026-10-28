import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
const { txQuery } = vi.hoisted(() => ({ txQuery: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryMany: vi.fn(),
  queryOne: vi.fn(),
  withTransaction: vi.fn(async (fn: any) => fn({ query: txQuery })),
}))
vi.mock('@/lib/email', () => ({ sendQuotationFinalizedEmail: vi.fn() }))
vi.mock('@/lib/catalog/site-controls', () => ({ getFeatureFlags: async () => ({ gstEnabled: true }) }))
vi.mock('@/lib/shared/customer-links', () => ({ documentUrl: async (_k: string, t: string) => `https://x/${t}` }))

// ── Imports ───────────────────────────────────────────────────────────────────

import { GET, PATCH, DELETE } from '@/app/api/(admin)/admin/quotations/[id]/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query, queryMany, queryOne, withTransaction } from '@/lib/shared/db'
import { sendQuotationFinalizedEmail } from '@/lib/email'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQuery = vi.mocked(query)
const mockQueryMany = vi.mocked(queryMany)
const mockQueryOne = vi.mocked(queryOne)
const mockSendEmail = vi.mocked(sendQuotationFinalizedEmail)

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'a1', role: 'super_admin', scopes: ['quotations'] }
const QT_ID = 'qt-id-001'
const PARAMS = { params: Promise.resolve({ id: QT_ID }) }

const draftQt = {
  id: QT_ID,
  status: 'draft',
  quote_number: 'QT/24-25/001',
  total_amount: '1200',
  subtotal: '1000',
  cgst_amount: '100',
  sgst_amount: '100',
  consignee_email: 'buyer@example.com',
  consignee_name: 'Buyer Corp',
  view_token: 'tok-abc',
}

const finalQt = { ...draftQt, status: 'final' }

function makeGetReq() {
  return new NextRequest(`http://localhost/api/admin/quotations/${QT_ID}`)
}
function makePatchReq(body: any) {
  return new NextRequest(`http://localhost/api/admin/quotations/${QT_ID}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}
function makeDeleteReq() {
  return new NextRequest(`http://localhost/api/admin/quotations/${QT_ID}`, { method: 'DELETE' })
}

// resetAllMocks also drains leftover mockResolvedValueOnce queues between tests.
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn({ query: txQuery }))
})

/** Fake tx client: UPDATE RETURNING yields `qt`; DELETE/INSERT return no rows. */
function txReturns(qt: any) {
  txQuery.mockImplementation(async (sql: string) => (sql.includes('UPDATE quotations') ? { rows: [qt] } : { rows: [] }))
}
const txSql = () => txQuery.mock.calls.map(([sql]) => String(sql))

// ── GET ───────────────────────────────────────────────────────────────────────

describe('GET /api/admin/quotations/[id]', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null as any)
    const res = await GET(makeGetReq(), PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeGetReq(), PARAMS)
    expect(res.status).toBe(403)
  })

  it('returns 404 when quotation not found', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await GET(makeGetReq(), PARAMS)
    expect(res.status).toBe(404)
  })

  it('returns quotation and items on happy path', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(draftQt)
    mockQueryMany.mockResolvedValueOnce([{ id: 'item1', description: 'Bolt' }])
    const res = await GET(makeGetReq(), PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.quotation.id).toBe(QT_ID)
    expect(body.items).toHaveLength(1)
  })

  it('returns empty items array when queryMany returns null', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(draftQt)
    mockQueryMany.mockResolvedValueOnce(null as any)
    const res = await GET(makeGetReq(), PARAMS)
    expect(res.status).toBe(200)
    expect((await res.json()).items).toEqual([])
  })

  it('returns 500 on unexpected error', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockRejectedValueOnce(new Error('DB down'))
    const res = await GET(makeGetReq(), PARAMS)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('DB down')
  })
})

// ── PATCH ─────────────────────────────────────────────────────────────────────

describe('PATCH /api/admin/quotations/[id]', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null as any)
    const res = await PATCH(makePatchReq({}), PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(false)
    const res = await PATCH(makePatchReq({}), PARAMS)
    expect(res.status).toBe(403)
  })

  it('returns 404 when quotation not found', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await PATCH(makePatchReq({}), PARAMS)
    expect(res.status).toBe(404)
  })

  it('updates fields without items on happy path', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(draftQt)
    txReturns({ ...draftQt, notes: 'updated' })
    mockQueryMany.mockResolvedValueOnce([]) // savedItems
    const res = await PATCH(makePatchReq({ notes: 'updated' }), PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.quotation.notes).toBe('updated')
    expect(body.items).toEqual([])
    expect(txSql().some(q => q.includes('quotation_items'))).toBe(false)
  })

  it('replaces items in one transaction (delete, inserts, header update) with server totals', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(draftQt)
    txReturns(draftQt)
    mockQueryMany.mockResolvedValueOnce([{ id: 'item1' }])

    const res = await PATCH(
      makePatchReq({
        items: [
          { description: 'Bolt M6', quantity: 10, rate: 10, discount_pct: 0, gst_rate: 18 },
          {
            description: 'Nut M6',
            quantity: 5,
            rate: 5,
            discount_pct: 0,
            gst_rate: 0,
            product_id: '11111111-1111-4111-8111-111111111111',
          },
        ],
      }),
      PARAMS
    )
    expect(res.status).toBe(200)
    const sqls = txSql()
    expect(sqls.filter(q => q.includes('DELETE FROM quotation_items'))).toHaveLength(1)
    expect(sqls.filter(q => q.includes('INSERT INTO quotation_items'))).toHaveLength(2)
    expect(sqls.findIndex(q => q.includes('DELETE'))).toBeLessThan(sqls.findIndex(q => q.includes('UPDATE quotations')))
    expect(mockQuery).not.toHaveBeenCalled()
    // 0% GST stays 0 (gst_rate is param index 4)
    const inserts = txQuery.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO quotation_items'))
    expect(inserts[1][1][4]).toBe(0)
    // totals: 100 + 25 subtotal, 18 tax → 143
    const update = txQuery.mock.calls.find(([sql]) => String(sql).includes('UPDATE quotations'))!
    expect(update[1]).toEqual(expect.arrayContaining([125, 9, 143]))
  })

  it('returns 400 with field messages for an invalid line and touches nothing', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(draftQt)
    const res = await PATCH(makePatchReq({ items: [{ description: '', quantity: 0, rate: 5 }] }), PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    // A draft may keep a blank name; an impossible quantity is still refused.
    expect(body.fields['items.0.description']).toBeUndefined()
    expect(body.fields['items.0.quantity']).toBeDefined()
    expect(withTransaction).not.toHaveBeenCalled()
  })

  it('returns 409 when items are changed on a converted quotation', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce({ ...draftQt, converted_order_id: 'ord-1' })
    const res = await PATCH(makePatchReq({ items: [{ description: 'X', quantity: 1, rate: 5 }] }), PARAMS)
    expect(res.status).toBe(409)
    expect(withTransaction).not.toHaveBeenCalled()
  })

  it('recomputes totals from existing items when total_amount=0 and no items supplied', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    const zeroTotalQt = { ...draftQt, total_amount: '0', subtotal: '0', cgst_amount: '0', sgst_amount: '0' }
    mockQueryOne.mockResolvedValueOnce(zeroTotalQt)
    mockQueryMany.mockResolvedValueOnce([
      { amount: 500, gst_rate: 18 },
      { amount: 300, gst_rate: 5 },
    ])
    txReturns(draftQt)
    mockQueryMany.mockResolvedValueOnce([])

    const res = await PATCH(makePatchReq({ notes: 'recomputed' }), PARAMS)
    expect(res.status).toBe(200)
    expect(mockQueryMany).toHaveBeenCalledTimes(2)
    const update = txQuery.mock.calls.find(([sql]) => String(sql).includes('UPDATE quotations'))!
    expect(update[1]).toEqual(expect.arrayContaining([800, 52.5, 905]))
  })

  it('sends finalization email when status=final and consignee_email present', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(draftQt)
    txReturns(finalQt)
    mockQueryMany.mockResolvedValueOnce([])
    mockSendEmail.mockResolvedValueOnce(undefined as any)

    const res = await PATCH(makePatchReq({ status: 'final' }), PARAMS)
    expect(res.status).toBe(200)
    expect(mockSendEmail).toHaveBeenCalledWith(
      'buyer@example.com',
      'Buyer Corp',
      'QT/24-25/001',
      1200,
      expect.stringContaining('tok-abc')
    )
  })

  it('does not propagate email errors on finalization', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(draftQt)
    txReturns(finalQt)
    mockQueryMany.mockResolvedValueOnce([])
    mockSendEmail.mockRejectedValueOnce(new Error('SMTP down'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await PATCH(makePatchReq({ status: 'final' }), PARAMS)
    expect(res.status).toBe(200)
    expect((await res.json()).quotation).toBeDefined()
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('skips email when status=final but no consignee_email', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(draftQt)
    txReturns({ ...finalQt, consignee_email: null })
    mockQueryMany.mockResolvedValueOnce([])

    const res = await PATCH(makePatchReq({ status: 'final' }), PARAMS)
    expect(res.status).toBe(200)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('returns 500 on unexpected PATCH error', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockRejectedValueOnce(new Error('Write failed'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await PATCH(makePatchReq({}), PARAMS)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Write failed')
    errSpy.mockRestore()
  })

  it('updates all text fields when provided', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(draftQt)
    txReturns(draftQt)
    mockQueryMany.mockResolvedValueOnce([])

    const res = await PATCH(
      makePatchReq({
        quote_date: '2024-06-01',
        status: 'sent',
        consignee_name: 'New Name',
        consignee_email: 'new@example.com',
        buyer_name: 'Buyer',
        notes: 'Revised',
      }),
      PARAMS
    )
    expect(res.status).toBe(200)
    const update = txQuery.mock.calls.find(([sql]) => String(sql).includes('UPDATE quotations'))!
    expect(String(update[0])).toContain('consignee_name = $')
    expect(update[1]).toEqual(expect.arrayContaining(['New Name', 'new@example.com', 'Revised', 'sent']))
  })

  it('returns 400 for an invalid consignee email', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(draftQt)
    const res = await PATCH(makePatchReq({ consignee_email: 'not-an-email' }), PARAMS)
    expect(res.status).toBe(400)
    expect((await res.json()).fields.consignee_email).toBeDefined()
  })
})

// ── DELETE ────────────────────────────────────────────────────────────────────

describe('DELETE /api/admin/quotations/[id]', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null as any)
    const res = await DELETE(makeDeleteReq(), PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(false)
    const res = await DELETE(makeDeleteReq(), PARAMS)
    expect(res.status).toBe(403)
  })

  it('returns 404 when quotation not found', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await DELETE(makeDeleteReq(), PARAMS)
    expect(res.status).toBe(404)
  })

  it('returns 400 when quotation is not a draft', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce({ ...draftQt, status: 'sent' })
    const res = await DELETE(makeDeleteReq(), PARAMS)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/draft/)
  })

  it('deletes draft quotation and detaches RFQ on happy path', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(draftQt)
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as any) // UPDATE business_rfqs detach
      .mockResolvedValueOnce({ rows: [] } as any) // DELETE quotations
    const res = await DELETE(makeDeleteReq(), PARAMS)
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(mockQuery).toHaveBeenCalledTimes(2)
  })

  it('returns 409 when FK constraint violation occurs', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(draftQt)
    const fkError = Object.assign(new Error('FK violation'), { code: '23503' })
    mockQuery.mockRejectedValueOnce(fkError)
    const res = await DELETE(makeDeleteReq(), PARAMS)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/RFQ/)
  })

  it('returns 500 on non-FK unexpected error', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(draftQt)
    mockQuery.mockRejectedValueOnce(new Error('Network error'))
    const res = await DELETE(makeDeleteReq(), PARAMS)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Network error')
  })
})
