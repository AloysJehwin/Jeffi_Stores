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
vi.mock('@/lib/mail-audit', () => ({ sendAuditedMail: vi.fn() }))

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
import { sendAuditedMail } from '@/lib/mail-audit'
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
})
