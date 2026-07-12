import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (must precede imports) ───────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
  getClient: vi.fn(),
}))
vi.mock('@/lib/automation-emails', () => ({ sendTestCampaignEmail: vi.fn() }))
vi.mock('@/lib/email', () => ({
  sendOrderDelayNotification: vi.fn(),
  sendProductAnnouncementEmail: vi.fn(),
  sendQuotationFinalizedEmail: vi.fn(),
  transporter: { sendMail: vi.fn() },
}))
vi.mock('@/lib/queries', () => ({ VARIANT_MIN_PRICE_SQL: 'COALESCE(0,0)' }))
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/inventory', () => ({ logStockMovement: vi.fn() }))

// ── Imports ────────────────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/agent/actions/[id]/approve/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryOne, queryMany, withTransaction, getClient } from '@/lib/db'
import { sendTestCampaignEmail } from '@/lib/automation-emails'
import { logActivity } from '@/lib/activity'
import {
  sendOrderDelayNotification,
  sendProductAnnouncementEmail,
  sendQuotationFinalizedEmail,
  transporter,
} from '@/lib/email'

// ── Helpers ────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'admin-uuid-1', role: 'super_admin', scopes: ['agent'] }
const ACTION_ID = 'action-uuid-1'

function makeReq(id = ACTION_ID) {
  return new NextRequest(`http://localhost/api/admin/agent/actions/${id}/approve`, {
    method: 'POST',
    headers: { cookie: 'admin_token=valid' },
  })
}

function params(id = ACTION_ID) {
  return { params: Promise.resolve({ id }) }
}

function proposed(kind: string, payload: unknown) {
  return {
    id: ACTION_ID,
    admin_id: ADMIN.adminId,
    conversation_id: 'conv-1',
    kind,
    payload,
    status: 'proposed',
  }
}

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQuery = vi.mocked(query)
const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)
const mockWithTransaction = vi.mocked(withTransaction)
const mockGetClient = vi.mocked(getClient)

// Global fetch mock — used by call_admin_api, create_pickup_request, sync_delhivery_statuses, export_gstr1
const originalFetch = global.fetch

// ── Tests ──────────────────────────────────────────────────────────────────

describe('POST /api/admin/agent/actions/[id]/approve', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rowCount: 1 } as any)
    // logActivity is called with .catch — must return a Promise
    vi.mocked(logActivity).mockResolvedValue(undefined as any)
    // default fetch: return a 200 empty response so any un-mocked call doesn't hit real network
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({}), text: async () => '',
    }) as any
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  // ── Auth / authz ────────────────────────────────────────────────────────

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  it('returns 403 when agent:write scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/insufficient/i)
  })

  it('returns 404 when action not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Action not found')
  })

  it('returns 403 when action belongs to different admin', async () => {
    mockQueryOne.mockResolvedValueOnce({
      ...proposed('send_test_email', {}),
      admin_id: 'other-admin',
    } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Not your action')
  })

  it('returns 400 when action already approved', async () => {
    mockQueryOne.mockResolvedValueOnce({
      ...proposed('send_test_email', {}),
      status: 'approved',
    } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/already approved/)
  })

  it('returns 400 when action already executed', async () => {
    mockQueryOne.mockResolvedValueOnce({
      ...proposed('send_test_email', {}),
      status: 'executed',
    } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/already executed/)
  })

  it('returns 400 when action already failed', async () => {
    mockQueryOne.mockResolvedValueOnce({
      ...proposed('send_test_email', {}),
      status: 'failed',
    } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/already failed/)
  })

  // ── send_test_email branches ────────────────────────────────────────────

  it('executes send_test_email successfully', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('send_test_email', { campaignKind: 'welcome', toEmail: 't@x.com' }) as any
    )
    vi.mocked(sendTestCampaignEmail).mockResolvedValue({ ok: true } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.result.sentTo).toBe('t@x.com')
  })

  it('returns 500 with reason when send_test_email fails', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('send_test_email', { campaignKind: 'welcome', toEmail: 't@x.com' }) as any
    )
    vi.mocked(sendTestCampaignEmail).mockResolvedValue({ ok: false, reason: 'Bounced' } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Bounced')
  })

  it('returns 500 with default message when send_test_email fails without reason', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('send_test_email', { campaignKind: 'welcome', toEmail: 't@x.com' }) as any
    )
    vi.mocked(sendTestCampaignEmail).mockResolvedValue({ ok: false } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Send failed')
  })

  // ── mark_order_shipped ─────────────────────────────────────────────────

  it('executes mark_order_shipped without awb', async () => {
    mockQueryOne
      .mockResolvedValueOnce(proposed('mark_order_shipped', { orderId: 'o1' }) as any)
      .mockResolvedValueOnce({ id: 'o1', order_number: 'ORD-1', status: 'shipped', awb_number: null } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    expect((await res.json()).result.status).toBe('shipped')
  })

  // ── send_order_delay_email ─────────────────────────────────────────────

  it('returns 500 when send_order_delay_email missing fields', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('send_order_delay_email', { customerEmail: 'x@y.com' }) as any
    )
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Missing required fields/)
  })

  it('returns 500 when send_order_delay_email service fails', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('send_order_delay_email', {
        customerEmail: 'x@y.com', customerName: null, orderNumber: 'ORD-1', delayDays: 3, reason: 'weather',
      }) as any
    )
    vi.mocked(sendOrderDelayNotification).mockResolvedValue({ success: false } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Send failed')
  })

  it('executes send_order_delay_email with default customer name "there"', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('send_order_delay_email', {
        customerEmail: 'x@y.com', customerName: null, orderNumber: 'ORD-1', delayDays: 3, reason: 'weather',
      }) as any
    )
    const spy = vi.mocked(sendOrderDelayNotification).mockResolvedValue({ success: true, messageId: 'mid' } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ customerName: 'there' }))
  })

  // ── send_product_announcement_email ────────────────────────────────────

  it('returns 500 when product_announcement resolves zero active products', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('send_product_announcement_email', {
        productIds: ['pid-1'], audience: 'test_only', testEmail: 't@x.com', subject: 'S', intro: 'I',
      }) as any
    )
    mockQueryMany.mockResolvedValueOnce([] as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/No active products/)
  })

  it('sends product announcement to all_opted_in audience', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('send_product_announcement_email', {
        productIds: ['pid-1'], audience: 'all_opted_in', testEmail: null, subject: 'S', intro: 'I',
      }) as any
    )
    mockQueryMany
      .mockResolvedValueOnce([{ id: 'pid-1', name: 'Bolt', slug: 'bolt', price: '100' }] as any)
      .mockResolvedValueOnce([{ email: 'a@x.com', name: 'Alice' }, { email: 'b@x.com', name: 'Bob' }] as any)
    vi.mocked(sendProductAnnouncementEmail).mockResolvedValue({ success: true } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.recipients).toBe(2)
    expect(body.result.sent).toBe(2)
  })

  it('sends product announcement to recent_buyers audience', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('send_product_announcement_email', {
        productIds: ['pid-1'], audience: 'recent_buyers', testEmail: null, subject: 'S', intro: 'I',
      }) as any
    )
    mockQueryMany
      .mockResolvedValueOnce([{ id: 'pid-1', name: 'Bolt', slug: 'bolt', price: '100' }] as any)
      .mockResolvedValueOnce([{ email: 'buyer@x.com', name: 'Buyer' }] as any)
    vi.mocked(sendProductAnnouncementEmail).mockResolvedValue({ success: true } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    expect((await res.json()).result.recipients).toBe(1)
  })

  it('reports failed sends when product announcement partially fails', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('send_product_announcement_email', {
        productIds: ['pid-1'], audience: 'test_only', testEmail: 't@x.com', subject: 'S', intro: 'I',
      }) as any
    )
    mockQueryMany.mockResolvedValueOnce([{ id: 'pid-1', name: 'Bolt', slug: 'bolt', price: '100' }] as any)
    vi.mocked(sendProductAnnouncementEmail).mockResolvedValue({ success: false } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/All 1 sends failed/)
  })

  // ── call_admin_api branches ────────────────────────────────────────────

  it('executes call_admin_api successfully', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('call_admin_api', { method: 'POST', path: '/api/admin/orders/refund', body: '{"id":"1"}' }) as any
    )
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ refunded: true }),
    }) as any
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.status).toBe(200)
    expect(body.result.body.refunded).toBe(true)
  })

  it('call_admin_api returns error when upstream not ok', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('call_admin_api', { method: 'POST', path: '/api/admin/orders/refund', body: null }) as any
    )
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 422, json: async () => ({ error: 'validation failed' }),
    }) as any
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Upstream returned 422/)
  })

  it('call_admin_api catches fetch exception', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('call_admin_api', { method: 'DELETE', path: '/api/admin/products/1', body: null }) as any
    )
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/ECONNREFUSED/)
  })

  it('call_admin_api rejects non-admin path', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('call_admin_api', { method: 'POST', path: '/api/public/something', body: null }) as any
    )
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/not permitted/)
  })

  it('call_admin_api rejects agent path (forbidden)', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('call_admin_api', { method: 'POST', path: '/api/admin/agent/chat', body: null }) as any
    )
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/not permitted/)
  })

  it('call_admin_api rejects team path (forbidden)', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('call_admin_api', { method: 'POST', path: '/api/admin/team', body: null }) as any
    )
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/not permitted/)
  })

  // ── mark_invoice_paid ──────────────────────────────────────────────────

  it('returns 500 when invoice not found', async () => {
    mockQueryOne
      .mockResolvedValueOnce(proposed('mark_invoice_paid', { orderId: 'o1', paymentMode: 'cash', paidAt: null }) as any)
      .mockResolvedValueOnce(null)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Invoice not found/)
  })

  // ── update_order_status branches ──────────────────────────────────────

  it('sets shipped_at and awb when update_order_status → shipped', async () => {
    mockQueryOne
      .mockResolvedValueOnce(proposed('update_order_status', { orderId: 'o1', newStatus: 'shipped', awbNumber: 'AWB99' }) as any)
      .mockResolvedValueOnce({ id: 'o1', order_number: 'ORD-1', status: 'shipped', awb_number: 'AWB99' } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    expect((await res.json()).result.awb_number).toBe('AWB99')
  })

  it('sets delivered_at when update_order_status → delivered', async () => {
    mockQueryOne
      .mockResolvedValueOnce(proposed('update_order_status', { orderId: 'o1', newStatus: 'delivered', awbNumber: null }) as any)
      .mockResolvedValueOnce({ id: 'o1', order_number: 'ORD-1', status: 'delivered', awb_number: null } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    expect((await res.json()).result.status).toBe('delivered')
  })

  it('sets cancelled_at when update_order_status → cancelled', async () => {
    mockQueryOne
      .mockResolvedValueOnce(proposed('update_order_status', { orderId: 'o1', newStatus: 'cancelled', awbNumber: null }) as any)
      .mockResolvedValueOnce({ id: 'o1', order_number: 'ORD-1', status: 'cancelled', awb_number: null } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    expect((await res.json()).result.status).toBe('cancelled')
  })

  it('returns 500 when update_order_status target not found', async () => {
    mockQueryOne
      .mockResolvedValueOnce(proposed('update_order_status', { orderId: 'missing', newStatus: 'confirmed', awbNumber: null }) as any)
      .mockResolvedValueOnce(null)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Order not found')
  })

  // ── create_coupon ──────────────────────────────────────────────────────

  it('returns 500 when create_coupon insert throws unique violation', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('create_coupon', {
        code: 'DUP', discountType: 'flat', discountValue: 100,
        validUntil: null, minPurchaseAmount: null, usageLimit: null, description: null,
      }) as any
    )
    const err: any = new Error('unique_violation')
    err.code = '23505'
    mockQueryOne.mockRejectedValueOnce(err)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/already exists/)
  })

  it('returns 500 when create_coupon insert throws generic error', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('create_coupon', {
        code: 'X', discountType: 'flat', discountValue: 100,
        validUntil: null, minPurchaseAmount: null, usageLimit: null, description: null,
      }) as any
    )
    mockQueryOne.mockRejectedValueOnce(new Error('db down'))
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/db down/)
  })

  // ── update_campaign_template ───────────────────────────────────────────

  it('returns 500 when update_campaign_template missing kind', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('update_campaign_template', { campaignKind: '', newSubject: 'S', newBody: 'B' }) as any
    )
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/campaignKind missing/)
  })

  it('returns 500 when update_campaign_template has no fields to update', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('update_campaign_template', { campaignKind: 'k', newSubject: null, newBody: null }) as any
    )
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/No fields to update/)
  })

  it('executes update_campaign_template with only subject', async () => {
    mockQueryOne
      .mockResolvedValueOnce(proposed('update_campaign_template', { campaignKind: 'k', newSubject: 'S', newBody: null }) as any)
      .mockResolvedValueOnce({ kind: 'k', name: 'K' } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.subjectChanged).toBe(true)
    expect(body.result.bodyChanged).toBe(false)
  })

  it('returns 500 when update_campaign_template campaign missing', async () => {
    mockQueryOne
      .mockResolvedValueOnce(proposed('update_campaign_template', { campaignKind: 'x', newSubject: 'S', newBody: null }) as any)
      .mockResolvedValueOnce(null)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Campaign not found/)
  })

  // ── send_mailer_broadcast ──────────────────────────────────────────────

  it('returns 500 when send_mailer_broadcast missing subject/body', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('send_mailer_broadcast', {
        audience: 'test_only', testEmail: 'x@y.com', subject: '', body: 'b', fromName: 'S',
      }) as any
    )
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/subject and body required/)
  })

  it('returns 500 when send_mailer_broadcast test_only missing testEmail', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('send_mailer_broadcast', {
        audience: 'test_only', testEmail: null, subject: 'Hi', body: 'b', fromName: 'S',
      }) as any
    )
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/testEmail missing/)
  })

  it('reports all-failed when mailer_broadcast sendMail rejects for every recipient', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('send_mailer_broadcast', {
        audience: 'test_only', testEmail: 'x@y.com', subject: 'Hi', body: '<p>Hello</p>', fromName: 'S',
      }) as any
    )
    vi.mocked(transporter.sendMail).mockRejectedValue(new Error('SMTP boom'))
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/All 1 sends failed/)
  })

  // ── generate_personalized_coupon ───────────────────────────────────────

  it('returns 500 when generate_personalized_coupon missing fields', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('generate_personalized_coupon', { userId: '', discountType: 'flat', discountValue: 100 }) as any
    )
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Missing required fields/)
  })

  it('executes generate_personalized_coupon successfully', async () => {
    mockQueryOne
      .mockResolvedValueOnce(
        proposed('generate_personalized_coupon', {
          userId: 'u1', customerEmail: 'c@x.com', discountType: 'flat', discountValue: 100,
          daysValid: 7, campaign: 'BIRTHDAY', validUntil: '2099-01-01',
        }) as any
      )
      .mockResolvedValueOnce({ id: 'coupon-1', code: 'BIRTHDAY-ABC123' } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.code).toMatch(/^BIRTHDAY-/)
  })

  it('returns 500 on generate_personalized_coupon unique violation', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('generate_personalized_coupon', {
        userId: 'u1', customerEmail: 'c@x.com', discountType: 'flat', discountValue: 100,
        daysValid: 7, campaign: 'BIRTHDAY', validUntil: '2099-01-01',
      }) as any
    )
    const err: any = new Error('unique')
    err.code = '23505'
    mockQueryOne.mockRejectedValueOnce(err)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/collision/)
  })

  // ── create_product ─────────────────────────────────────────────────────

  it('returns 500 when create_product duplicate SKU', async () => {
    mockQueryOne
      .mockResolvedValueOnce(
        proposed('create_product', {
          name: 'Bolt', sku: 'DUP', slug: 'bolt', basePrice: 100,
          brandId: null, categoryId: null, shortDescription: null, weightGrams: 50, gstPercentage: 18,
        }) as any
      )
      .mockResolvedValueOnce({ id: 'existing' } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/already exists/)
  })

  it('returns 500 when create_product insert returns null', async () => {
    mockQueryOne
      .mockResolvedValueOnce(
        proposed('create_product', {
          name: 'Bolt', sku: 'NEW', slug: 'bolt', basePrice: 100,
          brandId: null, categoryId: null, shortDescription: null, weightGrams: 50, gstPercentage: 18,
        }) as any
      )
      .mockResolvedValueOnce(null)  // dup check
      .mockResolvedValueOnce(null)  // insert fails
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Insert failed/)
  })

  // ── update_product ─────────────────────────────────────────────────────

  it('executes update_product with allowed fields', async () => {
    mockQueryOne
      .mockResolvedValueOnce(
        proposed('update_product', {
          productId: 'p1',
          changes: { name: 'New', base_price: 200, is_featured: true, brand_id: '', unknown: 'skip' },
        }) as any
      )
      .mockResolvedValueOnce({ id: 'p1', name: 'New', is_active: true, is_featured: true } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    expect((await res.json()).result.is_featured).toBe(true)
  })

  it('returns 500 when update_product target not found', async () => {
    mockQueryOne
      .mockResolvedValueOnce(proposed('update_product', { productId: 'p1', changes: { name: 'X' } }) as any)
      .mockResolvedValueOnce(null)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Product not found')
  })

  // ── adjust_inventory ──────────────────────────────────────────────────

  it('returns 500 when adjust_inventory delta is non-integer', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('adjust_inventory', { productId: 'p1', delta: 1.5, reason: 'x' }) as any
    )
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Invalid delta/)
  })

  it('returns 500 when adjust_inventory delta is zero', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('adjust_inventory', { productId: 'p1', delta: 0, reason: 'x' }) as any
    )
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Invalid delta/)
  })

  it('returns 500 when adjust_inventory product not found', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }), // SELECT
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValueOnce(client as any)
    mockQueryOne.mockResolvedValueOnce(
      proposed('adjust_inventory', { productId: 'p1', delta: 5, reason: 'restock' }) as any
    )
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Product not found')
  })

  it('returns 500 when adjust_inventory would push stock negative', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ inventory_quantity: 2 }] }),
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValueOnce(client as any)
    mockQueryOne.mockResolvedValueOnce(
      proposed('adjust_inventory', { productId: 'p1', delta: -5, reason: 'x' }) as any
    )
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/drop stock to -3/)
  })

  it('executes adjust_inventory successfully', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ inventory_quantity: 10 }] }) // SELECT
        .mockResolvedValueOnce({}) // UPDATE
        .mockResolvedValueOnce({}), // COMMIT
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValueOnce(client as any)
    mockQueryOne.mockResolvedValueOnce(
      proposed('adjust_inventory', { productId: 'p1', delta: 5, reason: 'restock' }) as any
    )
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.current).toBe(15)
    expect(client.release).toHaveBeenCalled()
  })

  // ── set_product_featured ──────────────────────────────────────────────

  it('returns 500 when set_product_featured hits limit', async () => {
    mockQueryOne
      .mockResolvedValueOnce(
        proposed('set_product_featured', { productId: 'p1', featured: true, limit: 6 }) as any
      )
      .mockResolvedValueOnce({ n: 6 } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Featured limit \(6\) reached/)
  })

  it('executes set_product_featured (unfeature) successfully', async () => {
    mockQueryOne
      .mockResolvedValueOnce(
        proposed('set_product_featured', { productId: 'p1', featured: false, limit: 6 }) as any
      )
      .mockResolvedValueOnce({ id: 'p1', name: 'X', is_featured: false } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    expect((await res.json()).result.is_featured).toBe(false)
  })

  // ── create_brand ──────────────────────────────────────────────────────

  it('returns 500 when create_brand slug duplicate', async () => {
    mockQueryOne
      .mockResolvedValueOnce(proposed('create_brand', { name: 'B', slug: 'b', logoUrl: null }) as any)
      .mockResolvedValueOnce({ id: 'existing' } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/already exists/)
  })

  it('executes create_brand successfully', async () => {
    mockQueryOne
      .mockResolvedValueOnce(proposed('create_brand', { name: 'B', slug: 'b', logoUrl: null }) as any)
      .mockResolvedValueOnce(null)  // dup check
      .mockResolvedValueOnce({ id: 'brand-1', name: 'B', slug: 'b', logo_url: null, is_active: true } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    expect((await res.json()).result.slug).toBe('b')
  })

  // ── create_category ───────────────────────────────────────────────────

  it('returns 500 when create_category missing name/slug', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('create_category', { name: '', slug: '', parentId: null }) as any
    )
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/name and slug required/)
  })

  it('returns 500 when create_category parent missing', async () => {
    mockQueryOne
      .mockResolvedValueOnce(proposed('create_category', { name: 'C', slug: 'c', parentId: 'ghost' }) as any)
      .mockResolvedValueOnce(null)  // parent lookup fails
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Parent category not found/)
  })

  it('returns 500 when create_category slug duplicate', async () => {
    mockQueryOne
      .mockResolvedValueOnce(proposed('create_category', { name: 'C', slug: 'c', parentId: null }) as any)
      .mockResolvedValueOnce({ id: 'existing' } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/already exists/)
  })

  it('executes create_category successfully', async () => {
    mockQueryOne
      .mockResolvedValueOnce(proposed('create_category', { name: 'C', slug: 'c', parentId: null }) as any)
      .mockResolvedValueOnce(null)  // dup
      .mockResolvedValueOnce({ id: 'cat-1', name: 'C', slug: 'c', parent_id: null, is_active: true } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    expect((await res.json()).result.slug).toBe('c')
  })

  // ── customer tag/task/note ────────────────────────────────────────────

  it('returns 500 when add_customer_note missing customerId', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('add_customer_note', { customerId: '', body: 'hi' }) as any
    )
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/customerId and body required/)
  })

  it('executes add_customer_tag successfully', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('add_customer_tag', { customerId: 'c1', tagSlug: 'VIP' }) as any
    )
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    expect((await res.json()).result.tag).toBe('vip')
  })

  it('returns 500 when add_customer_tag missing tag', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('add_customer_tag', { customerId: 'c1', tagSlug: '' }) as any
    )
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/tagSlug required/)
  })

  it('executes remove_customer_tag successfully', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('remove_customer_tag', { customerId: 'c1', tagSlug: 'vip' }) as any
    )
    mockQuery.mockResolvedValueOnce({ rowCount: 1 } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    expect((await res.json()).result.removed).toBe(1)
  })

  it('returns 500 when create_customer_task missing title', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('create_customer_task', {
        customerId: 'c1', title: '', dueAt: null, assignedToAdminId: null, priority: 'high',
      }) as any
    )
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/customerId and title required/)
  })

  it('executes create_customer_task with defaults for priority', async () => {
    mockQueryOne
      .mockResolvedValueOnce(
        proposed('create_customer_task', {
          customerId: 'c1', title: 'call', dueAt: null, assignedToAdminId: null, priority: 'weird',
        }) as any
      )
      .mockResolvedValueOnce({ id: 'task-1' } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    expect((await res.json()).result.priority).toBe('medium')
  })

  it('returns 500 when close_customer_task task not found', async () => {
    mockQueryOne
      .mockResolvedValueOnce(proposed('close_customer_task', { taskId: 't1', resolution: 'done' }) as any)
      .mockResolvedValueOnce(null)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Task not found')
  })

  it('returns 500 when close_customer_task already completed', async () => {
    mockQueryOne
      .mockResolvedValueOnce(proposed('close_customer_task', { taskId: 't1', resolution: 'r' }) as any)
      .mockResolvedValueOnce({ id: 't1', user_id: 'u1', title: 'T', status: 'completed', description: null } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Task already completed/)
  })

  it('executes close_customer_task with resolution appended', async () => {
    mockQueryOne
      .mockResolvedValueOnce(proposed('close_customer_task', { taskId: 't1', resolution: 'fixed' }) as any)
      .mockResolvedValueOnce({ id: 't1', user_id: 'u1', title: 'T', status: 'open', description: 'orig' } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    expect((await res.json()).result.taskId).toBe('t1')
  })

  it('returns 500 when close_customer_task missing taskId', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('close_customer_task', { taskId: '', resolution: null }) as any
    )
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/taskId required/)
  })

  it('returns 500 when toggle_marketing_opt_out customer missing', async () => {
    mockQueryOne
      .mockResolvedValueOnce(proposed('toggle_marketing_opt_out', { customerId: 'c1', optOut: true }) as any)
      .mockResolvedValueOnce(null)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Customer not found')
  })

  it('returns 500 when toggle_marketing_opt_out missing customerId', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('toggle_marketing_opt_out', { customerId: '', optOut: true }) as any
    )
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/customerId required/)
  })

  // ── create_tag_definition ─────────────────────────────────────────────

  it('returns 500 when create_tag_definition missing slug', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('create_tag_definition', { slug: '', color: 'red' }) as any
    )
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/slug required/)
  })

  it('returns 500 when create_tag_definition unique violation', async () => {
    mockQueryOne
      .mockResolvedValueOnce(proposed('create_tag_definition', { slug: 'vip', color: 'red' }) as any)
      .mockResolvedValueOnce({ sort_order: 20 } as any)
    const err: any = new Error('unique')
    err.code = '23505'
    // First query = status update (approved), second = tag INSERT (fails), third = final status update
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1 } as any)
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ rowCount: 1 } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Tag already exists/)
  })

  it('executes create_tag_definition successfully', async () => {
    mockQueryOne
      .mockResolvedValueOnce(proposed('create_tag_definition', { slug: 'vip', color: 'gold' }) as any)
      .mockResolvedValueOnce({ sort_order: 20 } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.slug).toBe('vip')
    expect(body.result.sort_order).toBe(30)
  })

  // ── create_pickup_request ─────────────────────────────────────────────

  it('returns 500 when create_pickup_request missing orderIds', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('create_pickup_request', { orderIds: [], pickupDate: '2099-01-01', orderCount: 0 }) as any
    )
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/orderIds missing/)
  })

  it('returns 500 when create_pickup_request invalid date', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('create_pickup_request', { orderIds: ['o1'], pickupDate: 'not-a-date', orderCount: 1 }) as any
    )
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/invalid pickupDate/)
  })

  it('executes create_pickup_request successfully', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('create_pickup_request', { orderIds: ['o1'], pickupDate: '2099-01-01', orderCount: 1 }) as any
    )
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ pickupId: 'PU-1', pickupDate: '2099-01-01', orderCount: 1, awbs: ['AWB1'] }),
    }) as any
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    expect((await res.json()).result.pickupId).toBe('PU-1')
  })

  // ── sync_delhivery_statuses ───────────────────────────────────────────

  it('executes sync_delhivery_statuses successfully', async () => {
    mockQueryOne.mockResolvedValueOnce(proposed('sync_delhivery_statuses', {}) as any)
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ total: 10, synced: 8, errors: [], rvp: { received: 2 } }),
    }) as any
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.synced).toBe(8)
    expect(body.result.rvpReceived).toBe(2)
  })

  it('returns 500 when sync_delhivery_statuses upstream fails', async () => {
    mockQueryOne.mockResolvedValueOnce(proposed('sync_delhivery_statuses', {}) as any)
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 502, json: async () => ({ error: 'Delhivery down' }),
    }) as any
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Delhivery down/)
  })

  // ── pay_payable ───────────────────────────────────────────────────────

  it('returns 500 when pay_payable amount invalid', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('pay_payable', {
        payableId: 'pay-1', expenseNumber: 'E1', supplierName: 'S',
        amount: 0, paymentMode: 'cash', paidAt: '2099-01-01', transactionRef: null,
      }) as any
    )
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/invalid payableId\/amount/)
  })

  it('returns 500 when pay_payable upstream not ok', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('pay_payable', {
        payableId: 'pay-1', expenseNumber: 'E1', supplierName: 'S',
        amount: 500, paymentMode: 'cash', paidAt: '2099-01-01', transactionRef: null,
      }) as any
    )
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 400, json: async () => ({ error: 'already paid' }),
    }) as any
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/already paid/)
  })

  it('executes pay_payable successfully', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('pay_payable', {
        payableId: 'pay-1', expenseNumber: 'E1', supplierName: 'S',
        amount: 500, paymentMode: 'cash', paidAt: '2099-01-01', transactionRef: 'TX1',
      }) as any
    )
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ new_status: 'paid', total_paid: 500 }),
    }) as any
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.newStatus).toBe('paid')
  })

  // ── export_gstr1 ──────────────────────────────────────────────────────

  it('returns 500 when export_gstr1 missing from/to', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('export_gstr1', { month: 'JAN', from: '', to: '', format: 'json', rowCount: 0 }) as any
    )
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/from\/to missing/)
  })

  it('exports GSTR-1 as csv', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('export_gstr1', { month: 'JAN', from: '2099-01-01', to: '2099-01-31', format: 'csv', rowCount: 3 }) as any
    )
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      text: async () => 'col1,col2\nA,B\n',
    }) as any
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.format).toBe('csv')
    expect(body.result.contentType).toBe('text/csv')
  })

  it('exports GSTR-1 as json', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('export_gstr1', { month: 'JAN', from: '2099-01-01', to: '2099-01-31', format: 'json', rowCount: 5 }) as any
    )
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ summary: { total: 100 }, b2b: [{}], b2c: [{}, {}], hsnSummary: [] }),
    }) as any
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.format).toBe('json')
    expect(body.result.b2bCount).toBe(1)
    expect(body.result.b2cCount).toBe(2)
  })

  it('returns 500 when export_gstr1 upstream fails', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('export_gstr1', { month: 'JAN', from: '2099-01-01', to: '2099-01-31', format: 'json', rowCount: 0 }) as any
    )
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 500, json: async () => ({ error: 'gst service down' }),
    }) as any
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/gst service down/)
  })

  // ── create_quotation ──────────────────────────────────────────────────

  it('returns 500 when create_quotation missing items', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('create_quotation', { items: [] }) as any
    )
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/items missing/)
  })

  it('returns 500 when create_quotation transaction throws', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('create_quotation', {
        consignee_email: 'c@x.com', consignee_name: 'C', consignee_addr1: 'a1',
        consignee_city: 'city', consignee_state: 'CG',
        items: [{ description: 'X', quantity: 1, rate: 100, discount_pct: 0, gst_rate: 18, unit: 'PCS', product_id: 'p1', amount: 100 }],
        buyer_same: true,
      }) as any
    )
    mockWithTransaction.mockRejectedValueOnce(new Error('deadlock'))
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/deadlock/)
  })

  it('executes create_quotation successfully', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('create_quotation', {
        consignee_email: 'c@x.com', consignee_name: 'C', consignee_addr1: 'a1',
        consignee_city: 'city', consignee_state: 'CG',
        items: [{ description: 'X', quantity: 2, rate: 100, discount_pct: 0, gst_rate: 18, unit: 'PCS', product_id: 'p1', amount: 200 }],
        buyer_same: true,
      }) as any
    )
    mockWithTransaction.mockResolvedValueOnce({ id: 'q1', quote_number: 'QT/24-25/JAN/1', view_token: 'tok' } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.quotationId).toBe('q1')
    expect(body.result.quoteNumber).toMatch(/^QT\//)
  })

  // ── send_quotation_email throws branch ────────────────────────────────

  it('returns 500 when send_quotation_email throws', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('send_quotation_email', {
        quoteNumber: 'QT/1', toEmail: 'x@y.com', consigneeName: 'A', totalAmount: 100, viewToken: 't',
      }) as any
    )
    vi.mocked(sendQuotationFinalizedEmail).mockRejectedValueOnce(new Error('smtp fail'))
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/smtp fail/)
  })

  // ── unknown action kind (default branch) ──────────────────────────────

  it('returns 500 for unknown action kind', async () => {
    mockQueryOne.mockResolvedValueOnce(proposed('mystery_action', {}) as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Unknown action kind/)
  })

  // ── status transition: approved → executed / failed ───────────────────

  it('marks action as approved, then executed on success', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('send_test_email', { campaignKind: 'welcome', toEmail: 't@x.com' }) as any
    )
    vi.mocked(sendTestCampaignEmail).mockResolvedValue({ ok: true } as any)
    await POST(makeReq(), params())
    const calls = mockQuery.mock.calls
    // first UPDATE: status = approved
    expect(calls[0][0]).toMatch(/SET status = 'approved'/)
    // second UPDATE: sets executed status
    expect(calls[1][0]).toMatch(/SET status = \$1/)
    expect(calls[1][1]?.[0]).toBe('executed')
  })

  it('marks action as failed when handler errors', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('send_test_email', { campaignKind: 'welcome', toEmail: 't@x.com' }) as any
    )
    vi.mocked(sendTestCampaignEmail).mockResolvedValue({ ok: false, reason: 'bounced' } as any)
    await POST(makeReq(), params())
    const calls = mockQuery.mock.calls
    expect(calls[1][1]?.[0]).toBe('failed')
    expect(calls[1][1]?.[2]).toBe('bounced')
  })
})
