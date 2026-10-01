import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (must precede imports) ───────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryMany: vi.fn(),
  queryOne: vi.fn(),
  withTransaction: vi.fn(),
  getClient: vi.fn(),
}))
vi.mock('@/lib/shared/automation-emails', () => ({ sendTestCampaignEmail: vi.fn() }))
vi.mock('@/lib/shared/mail-audit', () => ({ sendAuditedMail: vi.fn() }))

vi.mock('@/lib/email', () => ({
  sendOrderDelayNotification: vi.fn(),
  sendProductAnnouncementEmail: vi.fn(),
  sendQuotationFinalizedEmail: vi.fn(),
  transporter: { sendMail: vi.fn() },
}))
vi.mock('@/lib/queries', () => ({ VARIANT_MIN_PRICE_SQL: '0' }))
vi.mock('@/lib/shared/activity', () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/orders/inventory', () => ({ logStockMovement: vi.fn().mockResolvedValue(undefined) }))

// ── Imports ────────────────────────────────────────────────────────────────

import { POST } from '@/app/api/(admin)/admin/agent/actions/[id]/approve/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query, queryMany, queryOne, withTransaction, getClient } from '@/lib/shared/db'
import { sendTestCampaignEmail } from '@/lib/shared/automation-emails'
import * as activity from '@/lib/shared/activity'
import { sendAuditedMail } from '@/lib/shared/mail-audit'
import {
  sendOrderDelayNotification,
  sendProductAnnouncementEmail,
  sendQuotationFinalizedEmail,
  transporter,
} from '@/lib/email'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQuery = vi.mocked(query)
const mockQueryMany = vi.mocked(queryMany)
const mockQueryOne = vi.mocked(queryOne)
const mockWithTx = vi.mocked(withTransaction)
const mockGetClient = vi.mocked(getClient)
const mockSendTest = vi.mocked(sendTestCampaignEmail)
const mockDelay = vi.mocked(sendOrderDelayNotification)
const mockAnnounce = vi.mocked(sendProductAnnouncementEmail)
const mockQuoteEmail = vi.mocked(sendQuotationFinalizedEmail)
// Mail now goes through the audited chokepoint, not the raw transport.
const mockSendMail = vi.mocked(sendAuditedMail)

const ADMIN = { adminId: 'admin-1', role: 'super_admin', scopes: ['agent'] }
const ACTION_ID = 'action-uuid-1'

function makeReq() {
  return new NextRequest(`http://localhost/api/admin/agent/actions/${ACTION_ID}/approve`, {
    method: 'POST',
    headers: { cookie: 'admin_sid=valid' },
  })
}
const params = { params: Promise.resolve({ id: ACTION_ID }) }

function action(kind: string, payload: any, over: any = {}) {
  return {
    id: ACTION_ID,
    admin_id: 'admin-1',
    conversation_id: 'conv-1',
    kind,
    payload,
    status: 'proposed',
    ...over,
  }
}

// The route calls queryOne twice for control flow (action lookup), then again
// inside the action handler. This helper primes the action lookup then handler rows.
function primeAction(act: any, ...handlerRows: any[]) {
  mockQueryOne.mockResolvedValueOnce(act) // action lookup
  for (const r of handlerRows) mockQueryOne.mockResolvedValueOnce(r)
}

describe('POST /api/admin/agent/actions/[id]/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    mockQueryMany.mockResolvedValue([])
    mockQueryOne.mockReset()
    vi.mocked(activity.logActivity).mockResolvedValue(undefined as any)
  })

  // ── mark_invoice_paid ─────────────────────────────────────────────────────

  it('mark_invoice_paid success', async () => {
    primeAction(action('mark_invoice_paid', { orderId: 'o1', paymentMode: 'cash', paidAt: null }), {
      id: 'o1',
      invoice_number: 'INV-1',
      payment_status: 'paid',
      invoice_date: null,
    })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('mark_invoice_paid not found', async () => {
    primeAction(action('mark_invoice_paid', { orderId: 'o1', paymentMode: 'cash', paidAt: '2026-01-01' }), null)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  // ── update_order_status ───────────────────────────────────────────────────

  it('update_order_status invalid status', async () => {
    mockQueryOne.mockResolvedValueOnce(
      action('update_order_status', { orderId: 'o1', newStatus: 'bad', awbNumber: null })
    )
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/invalid status/i)
  })

  it('update_order_status shipped with awb success', async () => {
    primeAction(action('update_order_status', { orderId: 'o1', newStatus: 'shipped', awbNumber: 'AWB1' }), {
      id: 'o1',
      order_number: 'ORD-1',
      status: 'shipped',
      awb_number: 'AWB1',
    })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('update_order_status pending (no ts col) not found', async () => {
    primeAction(action('update_order_status', { orderId: 'o1', newStatus: 'pending', awbNumber: null }), null)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  // ── create_coupon ─────────────────────────────────────────────────────────

  it('create_coupon missing fields', async () => {
    mockQueryOne.mockResolvedValueOnce(action('create_coupon', { code: '', discountType: '', discountValue: 0 }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/missing required coupon/i)
  })

  it('create_coupon success', async () => {
    primeAction(
      action('create_coupon', {
        code: 'SAVE10',
        discountType: 'percentage',
        discountValue: 10,
        validUntil: null,
        minPurchaseAmount: null,
        usageLimit: null,
        description: null,
      }),
      { id: 'c1', code: 'SAVE10' }
    )
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('create_coupon duplicate (23505)', async () => {
    mockQueryOne.mockResolvedValueOnce(
      action('create_coupon', { code: 'DUP', discountType: 'percentage', discountValue: 5 })
    )
    mockQueryOne.mockRejectedValueOnce({ code: '23505' })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/already exists/i)
  })

  it('create_coupon insert returns null', async () => {
    primeAction(action('create_coupon', { code: 'X', discountType: 'flat', discountValue: 1 }), null)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/no row/i)
  })

  it('create_coupon insert throws non-conflict', async () => {
    mockQueryOne.mockResolvedValueOnce(action('create_coupon', { code: 'X', discountType: 'flat', discountValue: 1 }))
    mockQueryOne.mockRejectedValueOnce(new Error('db oops'))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/db oops/i)
  })

  // ── update_campaign_template ──────────────────────────────────────────────

  it('update_campaign_template missing campaignKind', async () => {
    mockQueryOne.mockResolvedValueOnce(
      action('update_campaign_template', { campaignKind: '', newSubject: 'S', newBody: null })
    )
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  it('update_campaign_template no fields', async () => {
    mockQueryOne.mockResolvedValueOnce(
      action('update_campaign_template', { campaignKind: 'welcome', newSubject: null, newBody: null })
    )
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/no fields/i)
  })

  it('update_campaign_template success both fields', async () => {
    primeAction(action('update_campaign_template', { campaignKind: 'welcome', newSubject: 'S', newBody: 'B' }), {
      kind: 'welcome',
      name: 'Welcome',
    })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('update_campaign_template not found', async () => {
    primeAction(action('update_campaign_template', { campaignKind: 'x', newSubject: 'S', newBody: null }), null)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  // ── send_mailer_broadcast ─────────────────────────────────────────────────

  it('send_mailer_broadcast subject/body required', async () => {
    mockQueryOne.mockResolvedValueOnce(
      action('send_mailer_broadcast', { audience: 'test_only', subject: '', body: '' })
    )
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  it('send_mailer_broadcast test_only missing testEmail', async () => {
    mockQueryOne.mockResolvedValueOnce(
      action('send_mailer_broadcast', {
        audience: 'test_only',
        testEmail: null,
        subject: 'S',
        body: 'B',
        fromName: 'Jeffi',
      })
    )
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  it('send_mailer_broadcast test_only success with template replace', async () => {
    mockQueryOne.mockResolvedValueOnce(
      action('send_mailer_broadcast', {
        audience: 'test_only',
        testEmail: 't@b.com',
        subject: 'S',
        body: 'Hi {firstName} <b>bold</b>',
        fromName: 'Jeffi "Stores"',
      })
    )
    mockSendMail.mockResolvedValue({} as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
    expect(mockSendMail).toHaveBeenCalled()
  })

  it('send_mailer_broadcast all_opted_in all fail', async () => {
    mockQueryOne.mockResolvedValueOnce(
      action('send_mailer_broadcast', {
        audience: 'all_opted_in',
        testEmail: null,
        subject: 'S',
        body: 'B',
        fromName: 'Jeffi',
      })
    )
    mockQueryMany.mockResolvedValueOnce([{ email: 'a@b.com', name: 'Al Pha' }])
    mockSendMail.mockRejectedValue(new Error('smtp'))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/all 1 sends failed/i)
  })

  it('send_mailer_broadcast recent_buyers success', async () => {
    mockQueryOne.mockResolvedValueOnce(
      action('send_mailer_broadcast', {
        audience: 'recent_buyers',
        testEmail: null,
        subject: 'S',
        body: 'B',
        fromName: '',
      })
    )
    mockQueryMany.mockResolvedValueOnce([{ email: 'a@b.com', name: '' }])
    mockSendMail.mockResolvedValue({} as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('send_mailer_broadcast unknown audience', async () => {
    mockQueryOne.mockResolvedValueOnce(
      action('send_mailer_broadcast', { audience: 'weird', testEmail: null, subject: 'S', body: 'B', fromName: 'X' })
    )
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/unknown audience/i)
  })

  // ── generate_personalized_coupon ──────────────────────────────────────────

  it('generate_personalized_coupon missing fields', async () => {
    mockQueryOne.mockResolvedValueOnce(
      action('generate_personalized_coupon', { userId: '', discountType: '', discountValue: 0 })
    )
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  it('generate_personalized_coupon success', async () => {
    primeAction(
      action('generate_personalized_coupon', {
        userId: 'u1',
        customerEmail: 'c@b.com',
        discountType: 'percentage',
        discountValue: 10,
        daysValid: 30,
        campaign: 'winback!',
        validUntil: '2026-12-31',
      }),
      { id: 'c1', code: 'WINBACK-ABC123' }
    )
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('generate_personalized_coupon empty campaign → OFFER prefix, insert null', async () => {
    primeAction(
      action('generate_personalized_coupon', {
        userId: 'u1',
        customerEmail: 'c@b.com',
        discountType: 'flat',
        discountValue: 5,
        daysValid: 7,
        campaign: '',
        validUntil: '2026-12-31',
      }),
      null
    )
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/no row/i)
  })

  it('generate_personalized_coupon collision (23505)', async () => {
    mockQueryOne.mockResolvedValueOnce(
      action('generate_personalized_coupon', {
        userId: 'u1',
        customerEmail: 'c@b.com',
        discountType: 'flat',
        discountValue: 5,
        daysValid: 7,
        campaign: 'X',
        validUntil: '2026-12-31',
      })
    )
    mockQueryOne.mockRejectedValueOnce({ code: '23505' })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/collision/i)
  })

  it('generate_personalized_coupon insert throws', async () => {
    mockQueryOne.mockResolvedValueOnce(
      action('generate_personalized_coupon', {
        userId: 'u1',
        customerEmail: 'c@b.com',
        discountType: 'flat',
        discountValue: 5,
        daysValid: 7,
        campaign: 'X',
        validUntil: '2026-12-31',
      })
    )
    mockQueryOne.mockRejectedValueOnce(new Error('boom'))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/boom/i)
  })

  // ── create_product ────────────────────────────────────────────────────────

  it('create_product invalid payload', async () => {
    mockQueryOne.mockResolvedValueOnce(action('create_product', { name: '', sku: '', slug: '', basePrice: -1 }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/invalid product/i)
  })

  it('create_product duplicate sku', async () => {
    primeAction(
      action('create_product', {
        name: 'N',
        sku: 'S1',
        slug: 's1',
        basePrice: 10,
        brandId: null,
        categoryId: null,
        shortDescription: null,
        weightGrams: 500,
        gstPercentage: 18,
      }),
      { id: 'existing' }
    )
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/already exists/i)
  })

  it('create_product success', async () => {
    primeAction(
      action('create_product', {
        name: 'N',
        sku: 'S1',
        slug: 's1',
        basePrice: 10,
        brandId: 'b1',
        categoryId: 'cat1',
        shortDescription: 'd',
        weightGrams: 500,
        gstPercentage: 18,
      }),
      null, // dup check → none
      { id: 'p1', name: 'N', sku: 'S1' }
    ) // insert
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('create_product insert fails', async () => {
    primeAction(
      action('create_product', {
        name: 'N',
        sku: 'S1',
        slug: 's1',
        basePrice: 10,
        brandId: null,
        categoryId: null,
        shortDescription: null,
        weightGrams: 500,
        gstPercentage: 18,
      }),
      null,
      null
    )
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/insert failed/i)
  })

  // ── update_product ────────────────────────────────────────────────────────

  it('update_product no valid fields', async () => {
    mockQueryOne.mockResolvedValueOnce(action('update_product', { productId: 'p1', changes: { bogus: 'x' } }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/no valid fields/i)
  })

  it('update_product success with brand_id and empty string', async () => {
    primeAction(
      action('update_product', { productId: 'p1', changes: { name: 'New', brand_id: 'b2', base_price: '' } }),
      { id: 'p1', name: 'New', is_active: true, is_featured: false }
    )
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('update_product not found', async () => {
    primeAction(action('update_product', { productId: 'p1', changes: { name: 'New' } }), null)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })
})
