import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryMany: vi.fn(),
  queryOne: vi.fn(),
}))
vi.mock('@/lib/email', () => ({ sendQuotationFinalizedEmail: vi.fn() }))
vi.mock('@/lib/catalog/pricing', () => ({ lineItemExGst: vi.fn().mockReturnValue(100) }))

// ── Imports ───────────────────────────────────────────────────────────────────

import { GET, PATCH, DELETE } from '@/app/api/admin/quotations/[id]/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query, queryMany, queryOne } from '@/lib/shared/db'
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

beforeEach(() => {
  vi.clearAllMocks()
})

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
    mockQueryOne.mockResolvedValueOnce(draftQt) // existing check
    mockQueryOne.mockResolvedValueOnce({ ...draftQt, notes: 'updated' }) // UPDATE RETURNING
    mockQueryMany.mockResolvedValueOnce([]) // savedItems
    const res = await PATCH(makePatchReq({ notes: 'updated' }), PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.quotation).toBeDefined()
    expect(body.items).toEqual([])
  })

  it('replaces items when items array supplied', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(draftQt)
    mockQuery.mockResolvedValue({ rows: [] } as any) // DELETE + INSERT calls
    mockQueryOne.mockResolvedValueOnce(draftQt) // UPDATE RETURNING
    mockQueryMany.mockResolvedValueOnce([{ id: 'item1' }])

    const res = await PATCH(
      makePatchReq({
        items: [
          { description: 'Bolt M6', quantity: 10, rate: 10, discount_pct: 0, gst_rate: 18 },
          { description: 'Nut M6', quantity: 5, rate: 5, discount_pct: 5, gst_rate: 12, product_id: 'p1' },
        ],
      }),
      PARAMS
    )
    expect(res.status).toBe(200)
    // DELETE was called
    const deleteCalls = mockQuery.mock.calls.filter(([sql]) => (sql as string).includes('DELETE FROM quotation_items'))
    expect(deleteCalls).toHaveLength(1)
    // INSERT was called for each item
    const insertCalls = mockQuery.mock.calls.filter(([sql]) => (sql as string).includes('INSERT INTO quotation_items'))
    expect(insertCalls).toHaveLength(2)
  })

  it('recomputes totals from existing items when total_amount=0 and no items supplied', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    const zeroTotalQt = { ...draftQt, total_amount: '0', subtotal: '0', cgst_amount: '0', sgst_amount: '0' }
    mockQueryOne.mockResolvedValueOnce(zeroTotalQt)
    mockQueryMany.mockResolvedValueOnce([
      { amount: 500, gst_rate: 18 },
      { amount: 300, gst_rate: 5 },
    ]) // existing items for recompute
    mockQueryOne.mockResolvedValueOnce(draftQt) // UPDATE RETURNING
    mockQueryMany.mockResolvedValueOnce([]) // savedItems

    const res = await PATCH(makePatchReq({ notes: 'recomputed' }), PARAMS)
    expect(res.status).toBe(200)
    // queryMany was called twice: once for existing items, once for savedItems
    expect(mockQueryMany).toHaveBeenCalledTimes(2)
  })

  it('sends finalization email when status=final and consignee_email present', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(draftQt)
    mockQueryOne.mockResolvedValueOnce(finalQt) // UPDATE RETURNING with status=final
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
    mockQueryOne.mockResolvedValueOnce(finalQt)
    mockQueryMany.mockResolvedValueOnce([])
    mockSendEmail.mockRejectedValueOnce(new Error('SMTP down'))

    const res = await PATCH(makePatchReq({ status: 'final' }), PARAMS)
    expect(res.status).toBe(200)
    expect((await res.json()).quotation).toBeDefined()
  })

  it('skips email when status=final but no consignee_email', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(draftQt)
    mockQueryOne.mockResolvedValueOnce({ ...finalQt, consignee_email: null })
    mockQueryMany.mockResolvedValueOnce([])

    const res = await PATCH(makePatchReq({ status: 'final' }), PARAMS)
    expect(res.status).toBe(200)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('returns 500 on unexpected PATCH error', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockRejectedValueOnce(new Error('Write failed'))
    const res = await PATCH(makePatchReq({}), PARAMS)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Write failed')
  })

  it('updates all text fields when provided', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(draftQt)
    mockQueryOne.mockResolvedValueOnce(draftQt)
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
    // The UPDATE was called with multiple $N params
    const updateCall = mockQueryOne.mock.calls.find(([sql]) => (sql as string).includes('UPDATE quotations'))
    expect(updateCall).toBeDefined()
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
