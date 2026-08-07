import { describe, it, expect, vi, beforeEach } from 'vitest'
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
import { sendOrderDelayNotification, sendProductAnnouncementEmail, sendQuotationFinalizedEmail, transporter } from '@/lib/email'
import { logStockMovement } from '@/lib/inventory'

// ── Helpers ────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'admin-uuid-1', role: 'super_admin', scopes: ['agent'] }
const ACTION_ID = 'action-uuid-1'

function makeReq(id = ACTION_ID) {
  return new NextRequest(`http://localhost/api/admin/agent/actions/${id}/approve`, {
    method: 'POST',
    headers: { cookie: 'admin_sid=valid' },
  })
}

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQuery = vi.mocked(query)
const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)
const mockWithTransaction = vi.mocked(withTransaction)
const mockGetClient = vi.mocked(getClient)

// ── Tests ──────────────────────────────────────────────────────────────────

describe('POST /api/admin/agent/actions/[id]/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rowCount: 1 } as any)
  })

  // ── Auth / authz ────────────────────────────────────────────────────────

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  it('returns 403 when agent scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/insufficient/i)
  })

  it('returns 404 when action not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(404)
  })

  it('returns 403 when action belongs to a different admin', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: 'other-admin', conversation_id: 'conv-1',
      kind: 'send_test_email', payload: {}, status: 'proposed',
    } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Not your action')
  })

  it('returns 400 when action is not in proposed status', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'send_test_email', payload: {}, status: 'executed',
    } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/already executed/)
  })

  // ── send_test_email ─────────────────────────────────────────────────────

  it('executes send_test_email action successfully', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'send_test_email',
      payload: { campaignKind: 'welcome', toEmail: 'test@example.com' },
      status: 'proposed',
    } as any)
    vi.mocked(sendTestCampaignEmail).mockResolvedValue({ ok: true } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.status).toBe('executed')
    expect(body.result.sentTo).toBe('test@example.com')
  })

  it('returns 500 when send_test_email fails', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'send_test_email',
      payload: { campaignKind: 'welcome', toEmail: 'test@example.com' },
      status: 'proposed',
    } as any)
    vi.mocked(sendTestCampaignEmail).mockResolvedValue({ ok: false, reason: 'SMTP error' } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('SMTP error')
  })

  // ── toggle_campaign_enabled ─────────────────────────────────────────────

  it('executes toggle_campaign_enabled successfully', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
        kind: 'toggle_campaign_enabled',
        payload: { campaignKind: 'welcome', enabled: true },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce({ kind: 'welcome', name: 'Welcome', enabled: true } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.kind).toBe('welcome')
  })

  it('returns 500 when campaign not found for toggle', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
        kind: 'toggle_campaign_enabled',
        payload: { campaignKind: 'nonexistent', enabled: false },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce(null)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Campaign not found')
  })

  // ── mark_order_shipped ──────────────────────────────────────────────────

  it('executes mark_order_shipped successfully', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
        kind: 'mark_order_shipped',
        payload: { orderId: 'order-1', awbNumber: 'AWB123' },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce({ id: 'order-1', order_number: 'ORD-001', status: 'shipped', awb_number: 'AWB123' } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.status).toBe('shipped')
  })

  it('returns 500 when order not found for mark_order_shipped', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
        kind: 'mark_order_shipped',
        payload: { orderId: 'bad-id', awbNumber: null },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce(null)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/not found|already shipped/)
  })

  // ── send_order_delay_email ──────────────────────────────────────────────

  it('executes send_order_delay_email successfully', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'send_order_delay_email',
      payload: { customerEmail: 'c@example.com', customerName: 'Alice', orderNumber: 'ORD-1', delayDays: 2, reason: 'Stock shortage' },
      status: 'proposed',
    } as any)
    vi.mocked(sendOrderDelayNotification).mockResolvedValue({ success: true, messageId: 'msg-1' } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect((await res.json()).result.sentTo).toBe('c@example.com')
  })

  it('returns 500 when send_order_delay_email missing required fields', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'send_order_delay_email',
      payload: { customerEmail: 'c@example.com' }, // missing orderNumber, delayDays, reason
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/missing/i)
  })

  // ── send_product_announcement_email ────────────────────────────────────

  it('returns 500 when productIds missing for product_announcement', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'send_product_announcement_email',
      payload: { productIds: [], audience: 'test_only', testEmail: 'x@y.com', subject: 'Hi', intro: 'Hello' },
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/productIds missing/)
  })

  it('executes product announcement for test_only audience', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'send_product_announcement_email',
      payload: { productIds: ['pid-1'], audience: 'test_only', testEmail: 'x@y.com', subject: 'New!', intro: 'Check this' },
      status: 'proposed',
    } as any)
    mockQueryMany.mockResolvedValueOnce([{ id: 'pid-1', name: 'Bolt', slug: 'bolt', price: '100', short_description: null, primary_image_url: null }] as any)
    vi.mocked(sendProductAnnouncementEmail).mockResolvedValue({ success: true } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.audience).toBe('test_only')
    expect(body.result.sent).toBe(1)
  })

  it('returns 500 when testEmail missing for test_only audience', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'send_product_announcement_email',
      payload: { productIds: ['pid-1'], audience: 'test_only', testEmail: null, subject: 'S', intro: 'I' },
      status: 'proposed',
    } as any)
    mockQueryMany.mockResolvedValueOnce([{ id: 'pid-1', name: 'Bolt', slug: 'bolt', price: '100', short_description: null, primary_image_url: null }] as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/testEmail missing/)
  })

  it('returns 500 for unknown audience in product announcement', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'send_product_announcement_email',
      payload: { productIds: ['pid-1'], audience: 'unknown_audience', testEmail: null, subject: 'S', intro: 'I' },
      status: 'proposed',
    } as any)
    mockQueryMany.mockResolvedValueOnce([{ id: 'pid-1', name: 'Bolt', slug: 'bolt', price: '100', short_description: null, primary_image_url: null }] as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Unknown audience/)
  })

  // ── call_admin_api ──────────────────────────────────────────────────────

  it('returns 500 for forbidden call_admin_api path', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'call_admin_api',
      payload: { method: 'POST', path: '/api/admin/agent/chat', body: null },
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/not permitted/)
  })

  it('returns 500 for non-mutating method in call_admin_api', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'call_admin_api',
      payload: { method: 'GET', path: '/api/admin/products', body: null },
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Method not permitted/)
  })

  // ── update_order_status ─────────────────────────────────────────────────

  it('executes update_order_status successfully', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
        kind: 'update_order_status',
        payload: { orderId: 'order-1', newStatus: 'confirmed', awbNumber: null },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce({ id: 'order-1', order_number: 'ORD-1', status: 'confirmed', awb_number: null } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect((await res.json()).result.status).toBe('confirmed')
  })

  it('returns 500 for invalid status in update_order_status', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'update_order_status',
      payload: { orderId: 'order-1', newStatus: 'flying', awbNumber: null },
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Invalid status')
  })

  // ── mark_invoice_paid ───────────────────────────────────────────────────

  it('executes mark_invoice_paid successfully', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
        kind: 'mark_invoice_paid',
        payload: { orderId: 'order-1', paymentMode: 'cash', paidAt: null },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce({ id: 'order-1', invoice_number: 'INV-1', payment_status: 'paid', invoice_date: null } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.payment_status).toBe('paid')
    expect(body.result.paymentMode).toBe('cash')
  })

  // ── create_coupon ───────────────────────────────────────────────────────

  it('executes create_coupon successfully', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
        kind: 'create_coupon',
        payload: { code: 'SAVE10', discountType: 'percentage', discountValue: 10, validUntil: null, minPurchaseAmount: null, usageLimit: null, description: null },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce({ id: 'coupon-1', code: 'SAVE10' } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.code).toBe('SAVE10')
  })

  it('returns 500 when coupon code missing', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'create_coupon',
      payload: { code: '', discountType: 'percentage', discountValue: 10 },
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Missing required coupon fields/)
  })

  // ── create_product ──────────────────────────────────────────────────────

  it('returns 500 when create_product payload invalid', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'create_product',
      payload: { name: '', sku: 'SKU1', slug: 'slug-1', basePrice: -5 },
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Invalid product payload/)
  })

  it('executes create_product successfully when sku is unique', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
        kind: 'create_product',
        payload: { name: 'Bolt', sku: 'BLT-01', slug: 'bolt', basePrice: 100, brandId: null, categoryId: null, shortDescription: null, weightGrams: 50, gstPercentage: 18 },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce(null)  // dup check: no dup
      .mockResolvedValueOnce({ id: 'prod-1', name: 'Bolt', sku: 'BLT-01' } as any)  // INSERT

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect((await res.json()).result.sku).toBe('BLT-01')
  })

  // ── update_product ──────────────────────────────────────────────────────

  it('returns 500 when update_product has no valid fields', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'update_product',
      payload: { productId: 'prod-1', changes: { unknown_field: 'value' } },
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/No valid fields/)
  })

  // ── add_customer_note ───────────────────────────────────────────────────

  it('executes add_customer_note successfully', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'add_customer_note',
      payload: { customerId: 'cust-1', body: 'Called customer about order delay' },
      status: 'proposed',
    } as any)
    vi.mocked(query).mockResolvedValue({ rowCount: 1 } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.customerId).toBe('cust-1')
  })

  it('returns 500 when add_customer_note body too long', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'add_customer_note',
      payload: { customerId: 'cust-1', body: 'x'.repeat(2001) },
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/too long/)
  })

  // ── create_brand ────────────────────────────────────────────────────────

  it('returns 500 when create_brand name or slug missing', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'create_brand',
      payload: { name: '', slug: '', logoUrl: null },
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/name and slug required/)
  })

  // ── unknown action kind ─────────────────────────────────────────────────

  it('returns 500 for unknown action kind', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'totally_unknown_kind',
      payload: {},
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Unknown action kind/)
  })

  // ── send_mailer_broadcast ───────────────────────────────────────────────

  it('returns 500 when send_mailer_broadcast has unknown audience', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'send_mailer_broadcast',
      payload: { audience: 'not_a_real_audience', testEmail: null, subject: 'Hi', body: '<p>Hello</p>', fromName: 'Store' },
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Unknown audience/)
  })

  it('executes send_mailer_broadcast for test_only audience', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'send_mailer_broadcast',
      payload: { audience: 'test_only', testEmail: 'admin@example.com', subject: 'Hi', body: '<p>Hello {firstName}</p>', fromName: 'Store' },
      status: 'proposed',
    } as any)
    vi.mocked(transporter.sendMail).mockResolvedValue({} as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.sent).toBe(1)
  })

  // ── send_quotation_email ────────────────────────────────────────────────

  it('executes send_quotation_email successfully', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'send_quotation_email',
      payload: { quoteNumber: 'QT/24-25/JAN/1', toEmail: 'buyer@co.com', consigneeName: 'Alice', totalAmount: 5000, viewToken: 'tok-abc' },
      status: 'proposed',
    } as any)
    vi.mocked(sendQuotationFinalizedEmail).mockResolvedValue(undefined as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect((await res.json()).result.sentTo).toBe('buyer@co.com')
  })

  it('returns 500 when send_quotation_email missing toEmail', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'send_quotation_email',
      payload: { quoteNumber: '', toEmail: '', consigneeName: '', totalAmount: 0, viewToken: '' },
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Missing recipient/)
  })

  // ── toggle_marketing_opt_out ────────────────────────────────────────────

  it('executes toggle_marketing_opt_out successfully', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
        kind: 'toggle_marketing_opt_out',
        payload: { customerId: 'cust-1', optOut: true },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce({ id: 'cust-1', email: 'c@x.com', marketing_opt_out: true } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect((await res.json()).result.marketing_opt_out).toBe(true)
  })

  // ── sync_delhivery_statuses ─────────────────────────────────────────────

  it('returns 500 when CRON_SECRET not configured for sync_delhivery_statuses', async () => {
    const savedCron = process.env.CRON_SECRET
    delete process.env.CRON_SECRET
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'sync_delhivery_statuses',
      payload: {},
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/CRON_SECRET not configured/)
    process.env.CRON_SECRET = savedCron
  })
})
