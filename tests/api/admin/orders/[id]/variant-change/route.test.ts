import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({ queryOne: vi.fn(), queryMany: vi.fn() }))
vi.mock('@/lib/site-controls', () => ({ getFeatureFlags: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notifyVariantChangeRequested: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/email', () => ({ sendVariantChangeRequestedEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/variant-change', () => ({
  computeVariantChangePreview: vi.fn(),
  loadVariantPriceRow: vi.fn(),
}))

import { GET, POST } from '@/app/api/admin/orders/[id]/variant-change/route'
import * as jwt from '@/lib/jwt'
import * as scopes from '@/lib/scopes'
import * as db from '@/lib/db'
import * as sc from '@/lib/site-controls'
import * as vc from '@/lib/variant-change'
import * as email from '@/lib/email'
import * as notify from '@/lib/notify'

const ADMIN = { adminId: 'admin-1', username: 'admin', role: 'super_admin', scopes: [] }
const PARAMS = { params: Promise.resolve({ id: 'order-1' }) }
const UUID = '11111111-1111-4111-8111-111111111111'
const UUID2 = '22222222-2222-4222-8222-222222222222'

function makeGet(qs = '') {
  return new NextRequest(new Request(`http://localhost/api/admin/orders/order-1/variant-change${qs}`)) as any
}
function makePost(body: unknown) {
  return new NextRequest(
    new Request('http://localhost/api/admin/orders/order-1/variant-change', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  ) as any
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
  vi.mocked(scopes.hasScope).mockReturnValue(true)
  vi.mocked(sc.getFeatureFlags).mockResolvedValue({ gstEnabled: true } as any)
  vi.mocked(db.queryMany).mockResolvedValue([] as any)
})

// ── GET ────────────────────────────────────────────────────────────────────

describe('GET variant-change', () => {
  it('401 when not admin', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null as any)
    expect((await GET(makeGet(), PARAMS)).status).toBe(401)
  })

  it('403 without orders:read scope', async () => {
    vi.mocked(scopes.hasScope).mockReturnValue(false)
    expect((await GET(makeGet(), PARAMS)).status).toBe(403)
  })

  it('history mode returns history list', async () => {
    vi.mocked(db.queryMany).mockResolvedValueOnce([{ id: 'h1' }] as any)
    const res = await GET(makeGet('?history=1'), PARAMS)
    expect(res.status).toBe(200)
    expect((await res.json()).history).toEqual([{ id: 'h1' }])
  })

  it('400 when productId missing', async () => {
    const res = await GET(makeGet(), PARAMS)
    expect(res.status).toBe(400)
  })

  it('returns variants + subVariants with effectivePrice', async () => {
    vi.mocked(db.queryMany)
      .mockResolvedValueOnce([{ id: 'v1', price: 120, price_ex_gst: 100 }] as any)
      .mockResolvedValueOnce([{ id: 'sv1', price: 60, price_ex_gst: 50 }] as any)
    const res = await GET(makeGet('?productId=prod-1'), PARAMS)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.gstEnabled).toBe(true)
    expect(body.variants[0].effectivePrice).toBe(120)
    expect(body.subVariants[0].effectivePrice).toBe(60)
  })

  it('500 on thrown error', async () => {
    vi.mocked(db.queryMany).mockRejectedValueOnce(new Error('boom'))
    const res = await GET(makeGet('?productId=prod-1'), PARAMS)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('boom')
  })
})

// ── POST ───────────────────────────────────────────────────────────────────

describe('POST variant-change', () => {
  const ORDER = {
    id: 'order-1',
    order_number: 'ORD-1',
    status: 'confirmed',
    payment_status: 'paid',
    payment_mode: 'razorpay',
    awb_number: null,
    user_id: 'user-1',
    customer_email: 'c@x.com',
    customer_name: 'Cust',
    user_email: 'u@x.com',
    first_name: 'Jane',
    last_name: 'Doe',
  }
  const ITEM = {
    id: 'item-1',
    product_id: 'prod-1',
    variant_id: 'old-v',
    sub_variant_id: null,
    quantity: '2',
    unit_price: '100',
    variant_name: 'Small',
  }
  const NEWV = { id: 'v-2', name: 'Large', sku: 'SKU-L', mrp: 150 }

  function setupHappy(previewOverride: any = {}) {
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(ORDER as any) // order
      .mockResolvedValueOnce(null as any) // no open request
      .mockResolvedValueOnce(ITEM as any) // order item
      .mockResolvedValueOnce({ id: 'vcr-1' } as any) // insert vcr
    vi.mocked(vc.loadVariantPriceRow).mockResolvedValue(NEWV as any)
    vi.mocked(vc.computeVariantChangePreview).mockReturnValue({
      oldUnitPrice: 100,
      newUnitPrice: 120,
      priceDiff: 40,
      settlementType: 'collect',
      codSettlement: 'cod_adjust',
      ...previewOverride,
    } as any)
  }

  it('401 when not admin', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null as any)
    expect((await POST(makePost({ orderItemId: UUID, newVariantId: UUID2 }), PARAMS)).status).toBe(401)
  })

  it('403 without orders:write', async () => {
    vi.mocked(scopes.hasScope).mockReturnValue(false)
    expect((await POST(makePost({ orderItemId: UUID, newVariantId: UUID2 }), PARAMS)).status).toBe(403)
  })

  it('400 on validation failure (no replacement)', async () => {
    const res = await POST(makePost({ orderItemId: UUID }), PARAMS)
    expect(res.status).toBe(400)
  })

  it('404 when order not found', async () => {
    vi.mocked(db.queryOne).mockResolvedValueOnce(null as any)
    const res = await POST(makePost({ orderItemId: UUID, newVariantId: UUID2 }), PARAMS)
    expect(res.status).toBe(404)
  })

  it('400 when order not confirmed', async () => {
    vi.mocked(db.queryOne).mockResolvedValueOnce({ ...ORDER, status: 'processing' } as any)
    const res = await POST(makePost({ orderItemId: UUID, newVariantId: UUID2 }), PARAMS)
    expect(res.status).toBe(400)
  })

  it('400 when order already shipped (awb)', async () => {
    vi.mocked(db.queryOne).mockResolvedValueOnce({ ...ORDER, awb_number: 'AWB1' } as any)
    const res = await POST(makePost({ orderItemId: UUID, newVariantId: UUID2 }), PARAMS)
    expect(res.status).toBe(400)
  })

  it('409 when open request exists', async () => {
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(ORDER as any)
      .mockResolvedValueOnce({ id: 'open-1' } as any)
    const res = await POST(makePost({ orderItemId: UUID, newVariantId: UUID2 }), PARAMS)
    expect(res.status).toBe(409)
  })

  it('404 when order item not found', async () => {
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(ORDER as any)
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce(null as any)
    const res = await POST(makePost({ orderItemId: UUID, newVariantId: UUID2 }), PARAMS)
    expect(res.status).toBe(404)
  })

  it('404 when replacement variant not found', async () => {
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(ORDER as any)
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce(ITEM as any)
    vi.mocked(vc.loadVariantPriceRow).mockResolvedValue(null as any)
    const res = await POST(makePost({ orderItemId: UUID, newVariantId: UUID2 }), PARAMS)
    expect(res.status).toBe(404)
  })

  it('creates request (online collect) and sends email + notify', async () => {
    setupHappy()
    // Force the .catch(() => {}) handlers on email/notify/logActivity to execute.
    vi.mocked(email.sendVariantChangeRequestedEmail).mockRejectedValueOnce(new Error('mail fail'))
    vi.mocked(notify.notifyVariantChangeRequested).mockRejectedValueOnce(new Error('notify fail'))
    const activity = await import('@/lib/activity')
    vi.mocked(activity.logActivity).mockRejectedValueOnce(new Error('log fail'))
    const res = await POST(makePost({ orderItemId: UUID, newVariantId: UUID2, adminNotes: 'note' }), PARAMS)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.requestId).toBe('vcr-1')
    expect(body.preview.settlementType).toBe('collect')
    expect(email.sendVariantChangeRequestedEmail).toHaveBeenCalled()
    expect(notify.notifyVariantChangeRequested).toHaveBeenCalled()
  })

  it('COD order maps collect → cod_adjust', async () => {
    setupHappy()
    vi.mocked(db.queryOne)
      .mockReset()
      .mockResolvedValueOnce({ ...ORDER, payment_mode: 'cod' } as any)
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce(ITEM as any)
      .mockResolvedValueOnce({ id: 'vcr-2' } as any)
    const res = await POST(makePost({ orderItemId: UUID, newVariantId: UUID2 }), PARAMS)
    const body = await res.json()
    expect(body.preview.settlementType).toBe('cod_adjust')
  })

  it('settlement none stays none regardless of COD', async () => {
    setupHappy({ priceDiff: 0, settlementType: 'none' })
    vi.mocked(db.queryOne)
      .mockReset()
      .mockResolvedValueOnce({ ...ORDER, payment_status: 'cod_pending' } as any)
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce(ITEM as any)
      .mockResolvedValueOnce({ id: 'vcr-3' } as any)
    const res = await POST(makePost({ orderItemId: UUID, newVariantId: UUID2 }), PARAMS)
    const body = await res.json()
    expect(body.preview.settlementType).toBe('none')
  })

  it('skips email when no customer email, skips activity when no user_id', async () => {
    setupHappy()
    vi.mocked(db.queryOne)
      .mockReset()
      .mockResolvedValueOnce({
        ...ORDER,
        user_id: null,
        user_email: null,
        customer_email: null,
        first_name: null,
        customer_name: null,
      } as any)
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce({ ...ITEM, variant_name: null } as any)
      .mockResolvedValueOnce({ id: 'vcr-4' } as any)
    const res = await POST(makePost({ orderItemId: UUID, newSubVariantId: UUID2 }), PARAMS)
    expect(res.status).toBe(200)
    expect(email.sendVariantChangeRequestedEmail).not.toHaveBeenCalled()
  })

  it('uses qty=1 fallback when quantity invalid', async () => {
    setupHappy()
    vi.mocked(db.queryOne)
      .mockReset()
      .mockResolvedValueOnce(ORDER as any)
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce({ ...ITEM, quantity: 'bad' } as any)
      .mockResolvedValueOnce({ id: 'vcr-5' } as any)
    const res = await POST(makePost({ orderItemId: UUID, newVariantId: UUID2 }), PARAMS)
    expect(res.status).toBe(200)
    expect(vi.mocked(vc.computeVariantChangePreview).mock.calls.at(-1)?.[0].qty).toBe(1)
  })

  it('500 on thrown error', async () => {
    vi.mocked(db.queryOne).mockRejectedValueOnce(new Error('db down'))
    const res = await POST(makePost({ orderItemId: UUID, newVariantId: UUID2 }), PARAMS)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('db down')
  })
})
