import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (must precede imports) ───────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({
  hasScope: vi.fn(),
  isPlatformOwner: (role: string) => role === 'administrator' || role === 'super_admin',
}))
vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
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
vi.mock('@/lib/queries', () => ({ VARIANT_MIN_PRICE_SQL: 'COALESCE(0,0)' }))
vi.mock('@/lib/shared/activity', () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/orders/inventory', () => ({ logStockMovement: vi.fn() }))

// ── Imports ────────────────────────────────────────────────────────────────

import { POST } from '@controller/app/api/(admin)/admin/agent/actions/[id]/approve/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query, queryOne, queryMany, withTransaction, getClient } from '@/lib/shared/db'
import { sendTestCampaignEmail } from '@/lib/shared/automation-emails'
import {
  sendOrderDelayNotification,
  sendProductAnnouncementEmail,
  sendQuotationFinalizedEmail,
  transporter,
} from '@/lib/email'
import { logStockMovement } from '@/lib/orders/inventory'

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

function mockFetchOk(data: unknown = { success: true }) {
  const fn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => data })
  vi.stubGlobal('fetch', fn)
  return fn
}
function mockFetchError(status: number, error: string) {
  const fn = vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({ error }) })
  vi.stubGlobal('fetch', fn)
  return fn
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('POST /api/admin/agent/actions/[id]/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rowCount: 1 } as any)
    vi.unstubAllGlobals()
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
      id: ACTION_ID,
      admin_id: 'other-admin',
      conversation_id: 'conv-1',
      kind: 'send_test_email',
      payload: {},
      status: 'proposed',
    } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Not your action')
  })

  it('returns 400 when action is not in proposed status', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'send_test_email',
      payload: {},
      status: 'executed',
    } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/already executed/)
  })

  // ── send_test_email ─────────────────────────────────────────────────────

  it('executes send_test_email action successfully', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
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
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
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
        id: ACTION_ID,
        admin_id: ADMIN.adminId,
        conversation_id: 'conv-1',
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
        id: ACTION_ID,
        admin_id: ADMIN.adminId,
        conversation_id: 'conv-1',
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

  it('executes mark_order_shipped through the order endpoints (AWB first, then status)', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'mark_order_shipped',
      payload: { orderId: 'order-1', orderNumber: 'ORD-001', awbNumber: 'AWB123' },
      status: 'proposed',
    } as any)
    const fetchMock = mockFetchOk()

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.status).toBe('shipped')
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/admin\/orders\/order-1$/)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ awb_number: 'AWB123' })
    expect(fetchMock.mock.calls[1][0]).toMatch(/\/api\/orders\/order-1$/)
    expect(fetchMock.mock.calls[1][1].method).toBe('PATCH')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ status: 'shipped' })
  })

  it("returns the order endpoint's error for mark_order_shipped", async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'mark_order_shipped',
      payload: { orderId: 'order-1', awbNumber: null },
      status: 'proposed',
    } as any)
    mockFetchError(400, "Cannot transition order from 'confirmed' to 'shipped'")

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Cannot transition/)
  })

  // ── send_order_delay_email ──────────────────────────────────────────────

  it('executes send_order_delay_email successfully', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'send_order_delay_email',
      payload: {
        customerEmail: 'c@example.com',
        customerName: 'Alice',
        orderNumber: 'ORD-1',
        delayDays: 2,
        reason: 'Stock shortage',
      },
      status: 'proposed',
    } as any)
    vi.mocked(sendOrderDelayNotification).mockResolvedValue({ success: true, messageId: 'msg-1' } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect((await res.json()).result.sentTo).toBe('c@example.com')
  })

  it('returns 500 when send_order_delay_email missing required fields', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
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
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
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
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'send_product_announcement_email',
      payload: {
        productIds: ['pid-1'],
        audience: 'test_only',
        testEmail: 'x@y.com',
        subject: 'New!',
        intro: 'Check this',
      },
      status: 'proposed',
    } as any)
    mockQueryMany.mockResolvedValueOnce([
      { id: 'pid-1', name: 'Bolt', slug: 'bolt', price: '100', short_description: null, primary_image_url: null },
    ] as any)
    vi.mocked(sendProductAnnouncementEmail).mockResolvedValue({ success: true } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.audience).toBe('test_only')
    expect(body.result.sent).toBe(1)
  })

  it('returns 500 when testEmail missing for test_only audience', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'send_product_announcement_email',
      payload: { productIds: ['pid-1'], audience: 'test_only', testEmail: null, subject: 'S', intro: 'I' },
      status: 'proposed',
    } as any)
    mockQueryMany.mockResolvedValueOnce([
      { id: 'pid-1', name: 'Bolt', slug: 'bolt', price: '100', short_description: null, primary_image_url: null },
    ] as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/testEmail missing/)
  })

  it('returns 500 for unknown audience in product announcement', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'send_product_announcement_email',
      payload: { productIds: ['pid-1'], audience: 'unknown_audience', testEmail: null, subject: 'S', intro: 'I' },
      status: 'proposed',
    } as any)
    mockQueryMany.mockResolvedValueOnce([
      { id: 'pid-1', name: 'Bolt', slug: 'bolt', price: '100', short_description: null, primary_image_url: null },
    ] as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Unknown audience/)
  })

  // ── call_admin_api ──────────────────────────────────────────────────────

  it('returns 500 for forbidden call_admin_api path', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
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
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'call_admin_api',
      payload: { method: 'GET', path: '/api/admin/products', body: null },
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Method not permitted/)
  })

  it('refuses call_admin_api to an order payment path (dedicated tool)', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'call_admin_api',
      payload: { method: 'PATCH', path: '/api/admin/orders/order-1/payment-status', body: '{"payment_status":"refunded"}' },
      status: 'proposed',
    } as any)
    const fetchMock = mockFetchOk()

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/propose_set_payment_status/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses call_admin_api for a non-owner approver', async () => {
    mockAuth.mockResolvedValue({ ...ADMIN, role: 'admin', scopes: ['agent:write'] } as any)
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'call_admin_api',
      payload: { method: 'POST', path: '/api/admin/products', body: null },
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/administrator or super admin/)
  })

  // ── update_order_status ─────────────────────────────────────────────────

  it('executes update_order_status through PATCH /api/orders/[id]', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'update_order_status',
      payload: { orderId: 'order-1', newStatus: 'confirmed', awbNumber: null },
      status: 'proposed',
    } as any)
    const fetchMock = mockFetchOk()

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect((await res.json()).result.status).toBe('confirmed')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ status: 'confirmed' })
  })

  it("returns the order endpoint's rule error for update_order_status", async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'update_order_status',
      payload: { orderId: 'order-1', newStatus: 'delivered', awbNumber: null },
      status: 'proposed',
    } as any)
    mockFetchError(400, "Cannot transition order from 'pending' to 'delivered'")

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe("Cannot transition order from 'pending' to 'delivered'")
  })

  it('sends an owner override with its reason', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'update_order_status',
      payload: { orderId: 'order-1', newStatus: 'pending', override: true, overrideReason: 'Customer re-opened the order' },
      status: 'proposed',
    } as any)
    const fetchMock = mockFetchOk()

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      status: 'pending',
      override: true,
      override_reason: 'Customer re-opened the order',
    })
  })

  it('refuses an override approved by a non-owner and marks the action failed', async () => {
    mockAuth.mockResolvedValue({ ...ADMIN, role: 'admin', scopes: ['agent:write', 'orders:write'] } as any)
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'update_order_status',
      payload: { orderId: 'order-1', newStatus: 'pending', override: true, overrideReason: 'Customer re-opened the order' },
      status: 'proposed',
    } as any)
    const fetchMock = mockFetchOk()

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/administrator or super admin/)
    expect(fetchMock).not.toHaveBeenCalled()
    const failed = mockQuery.mock.calls.find(c => /status = 'failed'/.test(String(c[0])))
    expect(failed?.[1]).toEqual([ADMIN.adminId, expect.stringMatching(/override/), ACTION_ID])
  })

  it('refuses an order change when the approver lacks orders:write', async () => {
    mockHasScope.mockImplementation((_role, _scopes, scope) => scope === 'agent:write')
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'update_order_status',
      payload: { orderId: 'order-1', newStatus: 'confirmed' },
      status: 'proposed',
    } as any)
    const fetchMock = mockFetchOk()

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/Orders \(write\)/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a plain "refunded" payment change', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'set_payment_status',
      payload: { orderId: 'order-1', paymentStatus: 'refunded', override: false },
      status: 'proposed',
    } as any)
    const fetchMock = mockFetchOk()

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/real refund/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // ── mark_invoice_paid ───────────────────────────────────────────────────

  it('executes mark_invoice_paid through the payment-status route', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'mark_invoice_paid',
      payload: { orderId: 'order-1', invoiceNumber: 'INV-1', paymentMode: 'cash', paidAt: null },
      status: 'proposed',
    } as any)
    const fetchMock = mockFetchOk()

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.payment_status).toBe('paid')
    expect(body.result.paymentMode).toBe('cash')
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/admin\/orders\/order-1\/payment-status$/)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ payment_status: 'paid', payment_mode: 'cash' })
  })

  // ── refund_order / cancel_order ─────────────────────────────────────────

  it('executes a Razorpay refund_order through the order refund route', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'refund_order',
      payload: { orderId: 'order-1', method: 'razorpay', amount: 500, reason: 'Cancelled by customer' },
      status: 'proposed',
    } as any)
    const fetchMock = mockFetchOk({ success: true, totalRefunded: 500 })

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect((await res.json()).result.totalRefunded).toBe(500)
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/orders\/order-1\/refund$/)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ reason: 'Cancelled by customer' })
  })

  it('records an external refund_order with its method, reference and note', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'refund_order',
      payload: { orderId: 'order-1', method: 'bank_transfer', amount: 300, reason: 'Damaged', notes: 'Paid to HDFC', reference: 'UTR1', notify: false },
      status: 'proposed',
    } as any)
    const fetchMock = mockFetchOk()

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      external: { method: 'bank_transfer', reference: 'UTR1', note: 'Damaged — Paid to HDFC' },
      amount: 300,
      notify: false,
      reason: 'Damaged',
    })
  })

  it('cancels an offline invoice through the invoice cancel route', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'cancel_order',
      payload: { orderId: 'order-1', source: 'offline', newStatus: 'cancelled' },
      status: 'proposed',
    } as any)
    const fetchMock = mockFetchOk()

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/admin\/orders\/order-1\/cancel$/)
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
  })

  // ── create_coupon ───────────────────────────────────────────────────────

  it('executes create_coupon successfully', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID,
        admin_id: ADMIN.adminId,
        conversation_id: 'conv-1',
        kind: 'create_coupon',
        payload: {
          code: 'SAVE10',
          discountType: 'percentage',
          discountValue: 10,
          validUntil: null,
          minPurchaseAmount: null,
          usageLimit: null,
          description: null,
        },
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
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
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
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
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
        id: ACTION_ID,
        admin_id: ADMIN.adminId,
        conversation_id: 'conv-1',
        kind: 'create_product',
        payload: {
          name: 'Bolt',
          sku: 'BLT-01',
          slug: 'bolt',
          basePrice: 100,
          brandId: null,
          categoryId: null,
          shortDescription: null,
          weightGrams: 50,
          gstPercentage: 18,
        },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce(null) // dup check: no dup
      .mockResolvedValueOnce({ id: 'prod-1', name: 'Bolt', sku: 'BLT-01' } as any) // INSERT

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect((await res.json()).result.sku).toBe('BLT-01')
  })

  // ── update_product ──────────────────────────────────────────────────────

  it('returns 500 when update_product has no valid fields', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'update_product',
      payload: { productId: 'prod-1', changes: { unknown_field: 'value' } },
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/No valid fields/)
  })
})
