import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (must precede imports) ───────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryMany: vi.fn(),
  queryOne: vi.fn(),
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
vi.mock('@/lib/queries', () => ({ VARIANT_MIN_PRICE_SQL: '0' }))
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/inventory', () => ({ logStockMovement: vi.fn().mockResolvedValue(undefined) }))

// ── Imports ────────────────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/agent/actions/[id]/approve/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryMany, queryOne, withTransaction, getClient } from '@/lib/db'
import { sendTestCampaignEmail } from '@/lib/automation-emails'
import * as activity from '@/lib/activity'
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
const mockSendMail = vi.mocked(transporter.sendMail)

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
    id: ACTION_ID, admin_id: 'admin-1', conversation_id: 'conv-1',
    kind, payload, status: 'proposed', ...over,
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

  // ── Auth / authz / preconditions ──────────────────────────────────────────

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(401)
  })

  it('returns 403 when agent:write scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(403)
  })

  it('returns 404 when action not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(404)
  })

  it('returns 403 when action belongs to another admin', async () => {
    mockQueryOne.mockResolvedValueOnce(action('mark_order_shipped', {}, { admin_id: 'someone-else' }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/not your action/i)
  })

  it('returns 400 when action is not in proposed state', async () => {
    mockQueryOne.mockResolvedValueOnce(action('mark_order_shipped', {}, { status: 'executed' }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/already executed/i)
  })

  // ── Unknown action kind ───────────────────────────────────────────────────

  it('returns 500 for unknown action kind', async () => {
    mockQueryOne.mockResolvedValueOnce(action('does_not_exist', {}))
    const res = await POST(makeReq(), params)
    const body = await res.json()
    expect(res.status).toBe(500)
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/unknown action kind/i)
  })

  // ── send_test_email ───────────────────────────────────────────────────────

  it('send_test_email success', async () => {
    mockQueryOne.mockResolvedValueOnce(action('send_test_email', { campaignKind: 'welcome', toEmail: 'a@b.com' }))
    mockSendTest.mockResolvedValue({ ok: true } as any)
    const res = await POST(makeReq(), params)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
  })

  it('send_test_email failure', async () => {
    mockQueryOne.mockResolvedValueOnce(action('send_test_email', { campaignKind: 'welcome', toEmail: 'a@b.com' }))
    mockSendTest.mockResolvedValue({ ok: false, reason: 'bounced' } as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('bounced')
  })

  // ── toggle_campaign_enabled ───────────────────────────────────────────────

  it('toggle_campaign_enabled success', async () => {
    primeAction(action('toggle_campaign_enabled', { campaignKind: 'welcome', enabled: true }),
      { kind: 'welcome', name: 'Welcome', enabled: true })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('toggle_campaign_enabled not found', async () => {
    primeAction(action('toggle_campaign_enabled', { campaignKind: 'x', enabled: false }), null)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/campaign not found/i)
  })

  // ── mark_order_shipped ────────────────────────────────────────────────────

  it('mark_order_shipped success', async () => {
    primeAction(action('mark_order_shipped', { orderId: 'o1', awbNumber: 'AWB1' }),
      { id: 'o1', order_number: 'ORD-1', status: 'shipped', awb_number: 'AWB1' })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('mark_order_shipped not found', async () => {
    primeAction(action('mark_order_shipped', { orderId: 'o1', awbNumber: null }), null)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  // ── send_order_delay_email ────────────────────────────────────────────────

  it('send_order_delay_email missing fields', async () => {
    mockQueryOne.mockResolvedValueOnce(action('send_order_delay_email', { customerEmail: '', orderNumber: '' }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/missing required/i)
  })

  it('send_order_delay_email success', async () => {
    mockQueryOne.mockResolvedValueOnce(action('send_order_delay_email',
      { customerEmail: 'a@b.com', orderNumber: 'ORD-1', delayDays: 3, reason: 'stock' }))
    mockDelay.mockResolvedValue({ success: true, messageId: 'm1' } as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('send_order_delay_email send failed', async () => {
    mockQueryOne.mockResolvedValueOnce(action('send_order_delay_email',
      { customerEmail: 'a@b.com', customerName: 'Bob', orderNumber: 'ORD-1', delayDays: 3, reason: 'stock' }))
    mockDelay.mockResolvedValue({ success: false } as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  // ── send_product_announcement_email ───────────────────────────────────────

  it('send_product_announcement_email productIds missing', async () => {
    mockQueryOne.mockResolvedValueOnce(action('send_product_announcement_email', { productIds: [] }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/productids missing/i)
  })

  it('send_product_announcement_email no active products', async () => {
    mockQueryOne.mockResolvedValueOnce(action('send_product_announcement_email',
      { productIds: ['p1'], audience: 'test_only', testEmail: 't@b.com', subject: 'S', intro: 'I' }))
    mockQueryMany.mockResolvedValueOnce([]) // products
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/no active products/i)
  })

  it('send_product_announcement_email test_only missing testEmail', async () => {
    mockQueryOne.mockResolvedValueOnce(action('send_product_announcement_email',
      { productIds: ['p1'], audience: 'test_only', testEmail: null, subject: 'S', intro: 'I' }))
    mockQueryMany.mockResolvedValueOnce([{ id: 'p1', name: 'X', slug: 'x', price: '1' }])
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/testemail missing/i)
  })

  it('send_product_announcement_email test_only success', async () => {
    mockQueryOne.mockResolvedValueOnce(action('send_product_announcement_email',
      { productIds: ['p1'], audience: 'test_only', testEmail: 't@b.com', subject: 'S', intro: 'I' }))
    mockQueryMany.mockResolvedValueOnce([{ id: 'p1', name: 'X', slug: 'x', price: '1' }])
    mockAnnounce.mockResolvedValue({ success: true } as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('send_product_announcement_email all_opted_in with all sends failing', async () => {
    mockQueryOne.mockResolvedValueOnce(action('send_product_announcement_email',
      { productIds: ['p1'], audience: 'all_opted_in', testEmail: null, subject: 'S', intro: 'I' }))
    mockQueryMany
      .mockResolvedValueOnce([{ id: 'p1', name: 'X', slug: 'x', price: '1' }]) // products
      .mockResolvedValueOnce([{ email: 'a@b.com', name: 'Al' }])               // recipients
    mockAnnounce.mockResolvedValue({ success: false } as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/all 1 sends failed/i)
  })

  it('send_product_announcement_email recent_buyers success', async () => {
    mockQueryOne.mockResolvedValueOnce(action('send_product_announcement_email',
      { productIds: ['p1'], audience: 'recent_buyers', testEmail: null, subject: 'S', intro: 'I' }))
    mockQueryMany
      .mockResolvedValueOnce([{ id: 'p1', name: 'X', slug: 'x', price: '1' }])
      .mockResolvedValueOnce([{ email: 'a@b.com', name: 'Al' }])
    mockAnnounce.mockResolvedValue({ success: true } as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('send_product_announcement_email unknown audience', async () => {
    mockQueryOne.mockResolvedValueOnce(action('send_product_announcement_email',
      { productIds: ['p1'], audience: 'weird', testEmail: null, subject: 'S', intro: 'I' }))
    mockQueryMany.mockResolvedValueOnce([{ id: 'p1', name: 'X', slug: 'x', price: '1' }])
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/unknown audience/i)
  })

  // ── call_admin_api ────────────────────────────────────────────────────────

  it('call_admin_api forbidden path', async () => {
    mockQueryOne.mockResolvedValueOnce(action('call_admin_api', { method: 'POST', path: '/api/admin/agent/x', body: null }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/not permitted/i)
  })

  it('call_admin_api bad method', async () => {
    mockQueryOne.mockResolvedValueOnce(action('call_admin_api', { method: 'GET', path: '/api/admin/products', body: null }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/method not permitted/i)
  })

  it('call_admin_api success', async () => {
    mockQueryOne.mockResolvedValueOnce(action('call_admin_api', { method: 'POST', path: '/api/admin/products', body: '{}' }))
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ done: true }) } as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('call_admin_api upstream error + json parse fallback to text', async () => {
    mockQueryOne.mockResolvedValueOnce(action('call_admin_api', { method: 'PUT', path: '/api/admin/products', body: null }))
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 400,
      json: async () => { throw new Error('not json') },
      text: async () => 'plain error',
    } as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/upstream returned 400/i)
  })

  it('call_admin_api fetch throws', async () => {
    mockQueryOne.mockResolvedValueOnce(action('call_admin_api', { method: 'DELETE', path: '/api/admin/products', body: null }))
    global.fetch = vi.fn().mockRejectedValue(new Error('network'))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/network/i)
  })

  // ── create_quotation ──────────────────────────────────────────────────────

  it('create_quotation items missing', async () => {
    mockQueryOne.mockResolvedValueOnce(action('create_quotation', { items: [] }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/items missing/i)
  })

  it('create_quotation success', async () => {
    mockQueryOne.mockResolvedValueOnce(action('create_quotation', {
      consignee_email: 'c@b.com', consignee_name: 'Cust', consignee_addr1: 'A1',
      consignee_city: 'City', consignee_state: 'ST', buyer_same: true,
      items: [{ description: 'X', quantity: 2, rate: 100, discount_pct: 0, hsn_code: '7318', gst_rate: 18, unit: 'PCS', buy_unit: null, product_id: 'prod-1', variant_id: 'var-1', sub_variant_id: 'sv-1', amount: 200 }],
    }))
    mockWithTx.mockImplementation(async (fn: any) => fn({
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ max_seq: '4' }] })                                   // seq
        .mockResolvedValueOnce({ rows: [{ id: 'q1', quote_number: 'QT/26-27/JAN/5', view_token: 'tok' }] }) // insert quotation
        .mockResolvedValue({ rows: [] }),                                                        // items
    }))
    const res = await POST(makeReq(), params)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.result.quotationId).toBe('q1')
  })

  it('create_quotation transaction error', async () => {
    mockQueryOne.mockResolvedValueOnce(action('create_quotation', {
      consignee_email: 'c@b.com', consignee_name: null, consignee_addr1: null,
      consignee_city: null, consignee_state: null, buyer_same: false,
      items: [{ description: 'X', quantity: 1, rate: 50, discount_pct: 0, hsn_code: null, gst_rate: 0, unit: '', buy_unit: null, product_id: 'p', variant_id: null, sub_variant_id: null, amount: 50 }],
    }))
    mockWithTx.mockRejectedValue(new Error('tx failed'))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/tx failed/i)
  })

  // ── send_quotation_email ──────────────────────────────────────────────────

  it('send_quotation_email missing recipient', async () => {
    mockQueryOne.mockResolvedValueOnce(action('send_quotation_email', { toEmail: '', quoteNumber: '' }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  it('send_quotation_email success', async () => {
    mockQueryOne.mockResolvedValueOnce(action('send_quotation_email',
      { quoteNumber: 'QT-1', toEmail: 'a@b.com', consigneeName: 'Cust', totalAmount: 100, viewToken: 'tok' }))
    mockQuoteEmail.mockResolvedValue(undefined as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('send_quotation_email send throws', async () => {
    mockQueryOne.mockResolvedValueOnce(action('send_quotation_email',
      { quoteNumber: 'QT-1', toEmail: 'a@b.com', consigneeName: '', totalAmount: 100, viewToken: 'tok' }))
    mockQuoteEmail.mockRejectedValue(new Error('smtp'))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/smtp/i)
  })

  // ── mark_invoice_paid ─────────────────────────────────────────────────────

  it('mark_invoice_paid success', async () => {
    primeAction(action('mark_invoice_paid', { orderId: 'o1', paymentMode: 'cash', paidAt: null }),
      { id: 'o1', invoice_number: 'INV-1', payment_status: 'paid', invoice_date: null })
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
    mockQueryOne.mockResolvedValueOnce(action('update_order_status', { orderId: 'o1', newStatus: 'bad', awbNumber: null }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/invalid status/i)
  })

  it('update_order_status shipped with awb success', async () => {
    primeAction(action('update_order_status', { orderId: 'o1', newStatus: 'shipped', awbNumber: 'AWB1' }),
      { id: 'o1', order_number: 'ORD-1', status: 'shipped', awb_number: 'AWB1' })
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
    primeAction(action('create_coupon', { code: 'SAVE10', discountType: 'percentage', discountValue: 10, validUntil: null, minPurchaseAmount: null, usageLimit: null, description: null }),
      { id: 'c1', code: 'SAVE10' })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('create_coupon duplicate (23505)', async () => {
    mockQueryOne.mockResolvedValueOnce(action('create_coupon', { code: 'DUP', discountType: 'percentage', discountValue: 5 }))
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
    mockQueryOne.mockResolvedValueOnce(action('update_campaign_template', { campaignKind: '', newSubject: 'S', newBody: null }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  it('update_campaign_template no fields', async () => {
    mockQueryOne.mockResolvedValueOnce(action('update_campaign_template', { campaignKind: 'welcome', newSubject: null, newBody: null }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/no fields/i)
  })

  it('update_campaign_template success both fields', async () => {
    primeAction(action('update_campaign_template', { campaignKind: 'welcome', newSubject: 'S', newBody: 'B' }),
      { kind: 'welcome', name: 'Welcome' })
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
    mockQueryOne.mockResolvedValueOnce(action('send_mailer_broadcast', { audience: 'test_only', subject: '', body: '' }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  it('send_mailer_broadcast test_only missing testEmail', async () => {
    mockQueryOne.mockResolvedValueOnce(action('send_mailer_broadcast',
      { audience: 'test_only', testEmail: null, subject: 'S', body: 'B', fromName: 'Jeffi' }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  it('send_mailer_broadcast test_only success with template replace', async () => {
    mockQueryOne.mockResolvedValueOnce(action('send_mailer_broadcast',
      { audience: 'test_only', testEmail: 't@b.com', subject: 'S', body: 'Hi {firstName} <b>bold</b>', fromName: 'Jeffi "Stores"' }))
    mockSendMail.mockResolvedValue({} as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
    expect(mockSendMail).toHaveBeenCalled()
  })

  it('send_mailer_broadcast all_opted_in all fail', async () => {
    mockQueryOne.mockResolvedValueOnce(action('send_mailer_broadcast',
      { audience: 'all_opted_in', testEmail: null, subject: 'S', body: 'B', fromName: 'Jeffi' }))
    mockQueryMany.mockResolvedValueOnce([{ email: 'a@b.com', name: 'Al Pha' }])
    mockSendMail.mockRejectedValue(new Error('smtp'))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/all 1 sends failed/i)
  })

  it('send_mailer_broadcast recent_buyers success', async () => {
    mockQueryOne.mockResolvedValueOnce(action('send_mailer_broadcast',
      { audience: 'recent_buyers', testEmail: null, subject: 'S', body: 'B', fromName: '' }))
    mockQueryMany.mockResolvedValueOnce([{ email: 'a@b.com', name: '' }])
    mockSendMail.mockResolvedValue({} as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('send_mailer_broadcast unknown audience', async () => {
    mockQueryOne.mockResolvedValueOnce(action('send_mailer_broadcast',
      { audience: 'weird', testEmail: null, subject: 'S', body: 'B', fromName: 'X' }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/unknown audience/i)
  })

  // ── generate_personalized_coupon ──────────────────────────────────────────

  it('generate_personalized_coupon missing fields', async () => {
    mockQueryOne.mockResolvedValueOnce(action('generate_personalized_coupon', { userId: '', discountType: '', discountValue: 0 }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  it('generate_personalized_coupon success', async () => {
    primeAction(action('generate_personalized_coupon',
      { userId: 'u1', customerEmail: 'c@b.com', discountType: 'percentage', discountValue: 10, daysValid: 30, campaign: 'winback!', validUntil: '2026-12-31' }),
      { id: 'c1', code: 'WINBACK-ABC123' })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('generate_personalized_coupon empty campaign → OFFER prefix, insert null', async () => {
    primeAction(action('generate_personalized_coupon',
      { userId: 'u1', customerEmail: 'c@b.com', discountType: 'flat', discountValue: 5, daysValid: 7, campaign: '', validUntil: '2026-12-31' }),
      null)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/no row/i)
  })

  it('generate_personalized_coupon collision (23505)', async () => {
    mockQueryOne.mockResolvedValueOnce(action('generate_personalized_coupon',
      { userId: 'u1', customerEmail: 'c@b.com', discountType: 'flat', discountValue: 5, daysValid: 7, campaign: 'X', validUntil: '2026-12-31' }))
    mockQueryOne.mockRejectedValueOnce({ code: '23505' })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/collision/i)
  })

  it('generate_personalized_coupon insert throws', async () => {
    mockQueryOne.mockResolvedValueOnce(action('generate_personalized_coupon',
      { userId: 'u1', customerEmail: 'c@b.com', discountType: 'flat', discountValue: 5, daysValid: 7, campaign: 'X', validUntil: '2026-12-31' }))
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
    primeAction(action('create_product', { name: 'N', sku: 'S1', slug: 's1', basePrice: 10, brandId: null, categoryId: null, shortDescription: null, weightGrams: 500, gstPercentage: 18 }),
      { id: 'existing' })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/already exists/i)
  })

  it('create_product success', async () => {
    primeAction(action('create_product', { name: 'N', sku: 'S1', slug: 's1', basePrice: 10, brandId: 'b1', categoryId: 'cat1', shortDescription: 'd', weightGrams: 500, gstPercentage: 18 }),
      null, // dup check → none
      { id: 'p1', name: 'N', sku: 'S1' }) // insert
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('create_product insert fails', async () => {
    primeAction(action('create_product', { name: 'N', sku: 'S1', slug: 's1', basePrice: 10, brandId: null, categoryId: null, shortDescription: null, weightGrams: 500, gstPercentage: 18 }),
      null, null)
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
    primeAction(action('update_product', { productId: 'p1', changes: { name: 'New', brand_id: 'b2', base_price: '' } }),
      { id: 'p1', name: 'New', is_active: true, is_featured: false })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('update_product not found', async () => {
    primeAction(action('update_product', { productId: 'p1', changes: { name: 'New' } }), null)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  // ── adjust_inventory ──────────────────────────────────────────────────────

  it('adjust_inventory invalid delta', async () => {
    mockQueryOne.mockResolvedValueOnce(action('adjust_inventory', { productId: 'p1', delta: 0, reason: 'x' }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/invalid delta/i)
  })

  it('adjust_inventory success', async () => {
    mockQueryOne.mockResolvedValueOnce(action('adjust_inventory', { productId: 'p1', delta: 5, reason: 'restock' }))
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce(undefined)                          // BEGIN
        .mockResolvedValueOnce({ rows: [{ inventory_quantity: 10 }] }) // SELECT FOR UPDATE
        .mockResolvedValueOnce(undefined)                          // UPDATE
        .mockResolvedValue(undefined),                             // COMMIT
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
    expect(client.release).toHaveBeenCalled()
  })

  it('adjust_inventory product not found', async () => {
    mockQueryOne.mockResolvedValueOnce(action('adjust_inventory', { productId: 'p1', delta: 5, reason: 'x' }))
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce(undefined)          // BEGIN
        .mockResolvedValueOnce({ rows: [] })       // SELECT → none
        .mockResolvedValue(undefined),             // ROLLBACK
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/product not found/i)
  })

  it('adjust_inventory would drop stock negative', async () => {
    mockQueryOne.mockResolvedValueOnce(action('adjust_inventory', { productId: 'p1', delta: -20, reason: 'x' }))
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [{ inventory_quantity: 5 }] })
        .mockResolvedValue(undefined),
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/would drop stock/i)
  })

  it('adjust_inventory throws mid-transaction', async () => {
    mockQueryOne.mockResolvedValueOnce(action('adjust_inventory', { productId: 'p1', delta: 5, reason: 'x' }))
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce(undefined)                              // BEGIN
        .mockRejectedValueOnce(new Error('lock timeout')),             // SELECT throws
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect(client.release).toHaveBeenCalled()
  })

  // ── set_product_featured ──────────────────────────────────────────────────

  it('set_product_featured under limit success', async () => {
    primeAction(action('set_product_featured', { productId: 'p1', featured: true, limit: 6 }),
      { n: 3 }, // count
      { id: 'p1', name: 'N', is_featured: true })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('set_product_featured limit reached', async () => {
    primeAction(action('set_product_featured', { productId: 'p1', featured: true, limit: 2 }),
      { n: 2 })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/limit .* reached/i)
  })

  it('set_product_featured unfeature not found', async () => {
    primeAction(action('set_product_featured', { productId: 'p1', featured: false, limit: 0 }),
      null) // update → not found
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  // ── create_brand ──────────────────────────────────────────────────────────

  it('create_brand missing name/slug', async () => {
    mockQueryOne.mockResolvedValueOnce(action('create_brand', { name: '', slug: '', logoUrl: null }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  it('create_brand duplicate', async () => {
    primeAction(action('create_brand', { name: 'Acme', slug: 'acme', logoUrl: null }), { id: 'b1' })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/already exists/i)
  })

  it('create_brand success', async () => {
    primeAction(action('create_brand', { name: 'Acme', slug: 'acme', logoUrl: 'l.png' }),
      null, { id: 'b1', name: 'Acme', slug: 'acme' })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('create_brand insert fails', async () => {
    primeAction(action('create_brand', { name: 'Acme', slug: 'acme', logoUrl: null }), null, null)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  // ── create_category ───────────────────────────────────────────────────────

  it('create_category missing name/slug', async () => {
    mockQueryOne.mockResolvedValueOnce(action('create_category', { name: '', slug: '', parentId: null }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  it('create_category parent not found', async () => {
    primeAction(action('create_category', { name: 'C', slug: 'c', parentId: 'par1' }), null)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/parent category not found/i)
  })

  it('create_category duplicate slug', async () => {
    primeAction(action('create_category', { name: 'C', slug: 'c', parentId: null }), { id: 'existing' })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/already exists/i)
  })

  it('create_category success with parent', async () => {
    primeAction(action('create_category', { name: 'C', slug: 'c', parentId: 'par1' }),
      { id: 'par1' }, // parent exists
      null,           // dup check none
      { id: 'cat1', name: 'C', slug: 'c', parent_id: 'par1', is_active: true })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('create_category insert fails', async () => {
    primeAction(action('create_category', { name: 'C', slug: 'c', parentId: null }), null, null)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  // ── add_customer_note ─────────────────────────────────────────────────────

  it('add_customer_note missing fields', async () => {
    mockQueryOne.mockResolvedValueOnce(action('add_customer_note', { customerId: '', body: '' }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  it('add_customer_note too long', async () => {
    mockQueryOne.mockResolvedValueOnce(action('add_customer_note', { customerId: 'u1', body: 'x'.repeat(2001) }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/too long/i)
  })

  it('add_customer_note success (long note truncated in summary)', async () => {
    mockQueryOne.mockResolvedValueOnce(action('add_customer_note', { customerId: 'u1', body: 'y'.repeat(150) }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  // ── add_customer_tag / remove_customer_tag ────────────────────────────────

  it('add_customer_tag missing fields', async () => {
    mockQueryOne.mockResolvedValueOnce(action('add_customer_tag', { customerId: '', tagSlug: '' }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  it('add_customer_tag success', async () => {
    mockQueryOne.mockResolvedValueOnce(action('add_customer_tag', { customerId: 'u1', tagSlug: 'VIP' }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('remove_customer_tag missing fields', async () => {
    mockQueryOne.mockResolvedValueOnce(action('remove_customer_tag', { customerId: '', tagSlug: '' }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  it('remove_customer_tag success', async () => {
    mockQueryOne.mockResolvedValueOnce(action('remove_customer_tag', { customerId: 'u1', tagSlug: 'vip' }))
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  // ── create_customer_task / close_customer_task ────────────────────────────

  it('create_customer_task missing fields', async () => {
    mockQueryOne.mockResolvedValueOnce(action('create_customer_task', { customerId: '', title: '' }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  it('create_customer_task success (invalid priority → medium)', async () => {
    primeAction(action('create_customer_task', { customerId: 'u1', title: 'Call', dueAt: null, assignedToAdminId: null, priority: 'bogus' }),
      { id: 'task-1' })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('create_customer_task insert fails', async () => {
    primeAction(action('create_customer_task', { customerId: 'u1', title: 'Call', dueAt: '2026-01-01', assignedToAdminId: 'a2', priority: 'high' }),
      null)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  it('close_customer_task missing taskId', async () => {
    mockQueryOne.mockResolvedValueOnce(action('close_customer_task', { taskId: '', resolution: null }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  it('close_customer_task not found', async () => {
    primeAction(action('close_customer_task', { taskId: 't1', resolution: 'done' }), null)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/task not found/i)
  })

  it('close_customer_task already completed', async () => {
    primeAction(action('close_customer_task', { taskId: 't1', resolution: null }),
      { id: 't1', user_id: 'u1', title: 'T', status: 'completed', description: null })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/already completed/i)
  })

  it('close_customer_task success with resolution (existing description)', async () => {
    primeAction(action('close_customer_task', { taskId: 't1', resolution: 'fixed it' }),
      { id: 't1', user_id: 'u1', title: 'T', status: 'open', description: 'prev' })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('close_customer_task success no resolution', async () => {
    primeAction(action('close_customer_task', { taskId: 't1', resolution: '' }),
      { id: 't1', user_id: 'u1', title: 'T', status: 'open', description: null })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  // ── toggle_marketing_opt_out ──────────────────────────────────────────────

  it('toggle_marketing_opt_out missing customerId', async () => {
    mockQueryOne.mockResolvedValueOnce(action('toggle_marketing_opt_out', { customerId: '', optOut: true }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  it('toggle_marketing_opt_out opt out success', async () => {
    primeAction(action('toggle_marketing_opt_out', { customerId: 'u1', optOut: true }),
      { id: 'u1', email: 'a@b.com', marketing_opt_out: true })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('toggle_marketing_opt_out opt in not found', async () => {
    primeAction(action('toggle_marketing_opt_out', { customerId: 'u1', optOut: false }), null)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  // ── create_tag_definition ─────────────────────────────────────────────────

  it('create_tag_definition missing slug', async () => {
    mockQueryOne.mockResolvedValueOnce(action('create_tag_definition', { slug: '', color: 'red' }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  it('create_tag_definition success', async () => {
    primeAction(action('create_tag_definition', { slug: 'vip', color: 'gold' }),
      { sort_order: 20 })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('create_tag_definition duplicate', async () => {
    primeAction(action('create_tag_definition', { slug: 'vip', color: '' }),
      { sort_order: 10 })
    mockQuery.mockImplementation(async (sql: any) =>
      String(sql).includes('customer_tag_definitions')
        ? Promise.reject({ code: '23505' })
        : ({ rows: [], rowCount: 1 } as any))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/already exists/i)
  })

  it('create_tag_definition insert throws', async () => {
    primeAction(action('create_tag_definition', { slug: 'vip', color: 'red' }), null)
    mockQuery.mockImplementation(async (sql: any) =>
      String(sql).includes('customer_tag_definitions')
        ? Promise.reject(new Error('db fail'))
        : ({ rows: [], rowCount: 1 } as any))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/db fail/i)
  })

  // ── create_pickup_request ─────────────────────────────────────────────────

  it('create_pickup_request orderIds missing', async () => {
    mockQueryOne.mockResolvedValueOnce(action('create_pickup_request', { orderIds: [], pickupDate: '2026-01-01', orderCount: 0 }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  it('create_pickup_request invalid date', async () => {
    mockQueryOne.mockResolvedValueOnce(action('create_pickup_request', { orderIds: ['o1'], pickupDate: 'bad', orderCount: 1 }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/invalid pickupdate/i)
  })

  it('create_pickup_request success', async () => {
    mockQueryOne.mockResolvedValueOnce(action('create_pickup_request', { orderIds: ['o1'], pickupDate: '2026-01-01', orderCount: 1 }))
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ pickupId: 'pk1', pickupDate: '2026-01-01', orderCount: 1, awbs: ['A1'] }) } as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('create_pickup_request upstream failure', async () => {
    mockQueryOne.mockResolvedValueOnce(action('create_pickup_request', { orderIds: ['o1'], pickupDate: '2026-01-01', orderCount: 1 }))
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'nope' }) } as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('nope')
  })

  // ── sync_delhivery_statuses ───────────────────────────────────────────────

  it('sync_delhivery_statuses no CRON_SECRET', async () => {
    const prev = process.env.CRON_SECRET
    delete process.env.CRON_SECRET
    mockQueryOne.mockResolvedValueOnce(action('sync_delhivery_statuses', {}))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/cron_secret/i)
    if (prev !== undefined) process.env.CRON_SECRET = prev
  })

  it('sync_delhivery_statuses success', async () => {
    process.env.CRON_SECRET = 'secret'
    mockQueryOne.mockResolvedValueOnce(action('sync_delhivery_statuses', {}))
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ total: 5, synced: 4, errors: [], rvp: { received: 1 } }) } as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
    delete process.env.CRON_SECRET
  })

  it('sync_delhivery_statuses upstream failure with json parse throw', async () => {
    process.env.CRON_SECRET = 'secret'
    mockQueryOne.mockResolvedValueOnce(action('sync_delhivery_statuses', {}))
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => { throw new Error('x') } } as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/sync failed/i)
    delete process.env.CRON_SECRET
  })

  // ── pay_payable ───────────────────────────────────────────────────────────

  it('pay_payable invalid amount', async () => {
    mockQueryOne.mockResolvedValueOnce(action('pay_payable', { payableId: 'py1', amount: 0 }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/invalid payableid/i)
  })

  it('pay_payable success', async () => {
    mockQueryOne.mockResolvedValueOnce(action('pay_payable',
      { payableId: 'py1', expenseNumber: 'E1', supplierName: 'S', amount: 100, paymentMode: 'cash', paidAt: '2026-01-01', transactionRef: 'ref1' }))
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ new_status: 'paid', total_paid: 100 }) } as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('pay_payable upstream failure', async () => {
    mockQueryOne.mockResolvedValueOnce(action('pay_payable',
      { payableId: 'py1', expenseNumber: 'E1', supplierName: 'S', amount: 100, paymentMode: 'cash', paidAt: '2026-01-01', transactionRef: null }))
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'bad' }) } as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('bad')
  })

  // ── export_gstr1 ──────────────────────────────────────────────────────────

  it('export_gstr1 missing from/to', async () => {
    mockQueryOne.mockResolvedValueOnce(action('export_gstr1', { month: 'Jan', from: '', to: '', format: 'json', rowCount: 0 }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  it('export_gstr1 json success', async () => {
    mockQueryOne.mockResolvedValueOnce(action('export_gstr1', { month: 'Jan', from: '2026-01-01', to: '2026-01-31', format: 'json', rowCount: 3 }))
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ summary: {}, b2b: [1], b2c: [], hsnSummary: [] }) } as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('export_gstr1 csv success', async () => {
    mockQueryOne.mockResolvedValueOnce(action('export_gstr1', { month: 'Jan', from: '2026-01-01', to: '2026-01-31', format: 'csv', rowCount: 3 }))
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => 'a,b\n1,2' } as any)
    const res = await POST(makeReq(), params)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.result.format).toBe('csv')
    expect(body.result.contentBase64).toBeTruthy()
  })

  it('export_gstr1 upstream failure with json error', async () => {
    mockQueryOne.mockResolvedValueOnce(action('export_gstr1', { month: 'Jan', from: '2026-01-01', to: '2026-01-31', format: 'json', rowCount: 3 }))
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'gst boom' }) } as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('gst boom')
  })

  it('export_gstr1 upstream failure json parse throws', async () => {
    mockQueryOne.mockResolvedValueOnce(action('export_gstr1', { month: 'Jan', from: '2026-01-01', to: '2026-01-31', format: 'csv', rowCount: 3 }))
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => { throw new Error('x') } } as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/gstr-1 export failed/i)
  })

  // ── logActivity fire-and-forget catch closures ────────────────────────────
  // Make logActivity reject so every `.catch(() => {})` closure attached to it
  // executes (covers the anonymous catch handlers across the customer actions).

  it('customer actions swallow logActivity rejection (add_customer_note)', async () => {
    vi.mocked(activity.logActivity).mockRejectedValue(new Error('log down'))
    mockQueryOne.mockResolvedValueOnce(action('add_customer_note', { customerId: 'u1', body: 'note' }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
    await new Promise((r) => setTimeout(r, 0))
  })

  it('customer actions swallow logActivity rejection (add_customer_tag)', async () => {
    vi.mocked(activity.logActivity).mockRejectedValue(new Error('log down'))
    mockQueryOne.mockResolvedValueOnce(action('add_customer_tag', { customerId: 'u1', tagSlug: 'vip' }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
    await new Promise((r) => setTimeout(r, 0))
  })

  it('customer actions swallow logActivity rejection (remove_customer_tag)', async () => {
    vi.mocked(activity.logActivity).mockRejectedValue(new Error('log down'))
    mockQueryOne.mockResolvedValueOnce(action('remove_customer_tag', { customerId: 'u1', tagSlug: 'vip' }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
    await new Promise((r) => setTimeout(r, 0))
  })

  it('customer actions swallow logActivity rejection (create_customer_task)', async () => {
    vi.mocked(activity.logActivity).mockRejectedValue(new Error('log down'))
    primeAction(action('create_customer_task', { customerId: 'u1', title: 'T', dueAt: null, assignedToAdminId: null, priority: 'high' }),
      { id: 'task-1' })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
    await new Promise((r) => setTimeout(r, 0))
  })

  it('customer actions swallow logActivity rejection (close_customer_task)', async () => {
    vi.mocked(activity.logActivity).mockRejectedValue(new Error('log down'))
    primeAction(action('close_customer_task', { taskId: 't1', resolution: 'done' }),
      { id: 't1', user_id: 'u1', title: 'T', status: 'open', description: null })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
    await new Promise((r) => setTimeout(r, 0))
  })

  it('customer actions swallow logActivity rejection (toggle_marketing_opt_out)', async () => {
    vi.mocked(activity.logActivity).mockRejectedValue(new Error('log down'))
    primeAction(action('toggle_marketing_opt_out', { customerId: 'u1', optOut: true }),
      { id: 'u1', email: 'a@b.com', marketing_opt_out: true })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
    await new Promise((r) => setTimeout(r, 0))
  })

  it('call_admin_api json+text both throw → data null (text catch closure)', async () => {
    mockQueryOne.mockResolvedValueOnce(action('call_admin_api', { method: 'POST', path: '/api/admin/products', body: null }))
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => { throw new Error('no json') },
      text: async () => { throw new Error('no text') },
    } as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('create_pickup_request internal api text fallback (callInternalApi json throws)', async () => {
    mockQueryOne.mockResolvedValueOnce(action('create_pickup_request', { orderIds: ['o1'], pickupDate: '2026-01-01', orderCount: 1 }))
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 500,
      json: async () => { throw new Error('no json') },
      text: async () => { throw new Error('no text') },
    } as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })
})
