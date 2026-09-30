import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (must precede imports) ───────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
  getClient: vi.fn(),
}))
vi.mock('@/lib/shared/automation-emails', () => ({ sendTestCampaignEmail: vi.fn() }))
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

import { POST } from '@/app/api/admin/agent/actions/[id]/approve/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query, queryOne, queryMany, withTransaction, getClient } from '@/lib/shared/db'
import { sendTestCampaignEmail } from '@/lib/shared/automation-emails'
import { logActivity } from '@/lib/shared/activity'
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
    headers: { cookie: 'admin_sid=valid' },
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
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '',
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
    mockQueryOne.mockResolvedValueOnce(proposed('send_order_delay_email', { customerEmail: 'x@y.com' }) as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Missing required fields/)
  })

  it('returns 500 when send_order_delay_email service fails', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('send_order_delay_email', {
        customerEmail: 'x@y.com',
        customerName: null,
        orderNumber: 'ORD-1',
        delayDays: 3,
        reason: 'weather',
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
        customerEmail: 'x@y.com',
        customerName: null,
        orderNumber: 'ORD-1',
        delayDays: 3,
        reason: 'weather',
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
        productIds: ['pid-1'],
        audience: 'test_only',
        testEmail: 't@x.com',
        subject: 'S',
        intro: 'I',
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
        productIds: ['pid-1'],
        audience: 'all_opted_in',
        testEmail: null,
        subject: 'S',
        intro: 'I',
      }) as any
    )
    mockQueryMany
      .mockResolvedValueOnce([{ id: 'pid-1', name: 'Bolt', slug: 'bolt', price: '100' }] as any)
      .mockResolvedValueOnce([
        { email: 'a@x.com', name: 'Alice' },
        { email: 'b@x.com', name: 'Bob' },
      ] as any)
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
        productIds: ['pid-1'],
        audience: 'recent_buyers',
        testEmail: null,
        subject: 'S',
        intro: 'I',
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
        productIds: ['pid-1'],
        audience: 'test_only',
        testEmail: 't@x.com',
        subject: 'S',
        intro: 'I',
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
      ok: true,
      status: 200,
      json: async () => ({ refunded: true }),
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
      ok: false,
      status: 422,
      json: async () => ({ error: 'validation failed' }),
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
      .mockResolvedValueOnce(
        proposed('update_order_status', { orderId: 'o1', newStatus: 'shipped', awbNumber: 'AWB99' }) as any
      )
      .mockResolvedValueOnce({ id: 'o1', order_number: 'ORD-1', status: 'shipped', awb_number: 'AWB99' } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    expect((await res.json()).result.awb_number).toBe('AWB99')
  })

  it('sets delivered_at when update_order_status → delivered', async () => {
    mockQueryOne
      .mockResolvedValueOnce(
        proposed('update_order_status', { orderId: 'o1', newStatus: 'delivered', awbNumber: null }) as any
      )
      .mockResolvedValueOnce({ id: 'o1', order_number: 'ORD-1', status: 'delivered', awb_number: null } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    expect((await res.json()).result.status).toBe('delivered')
  })

  it('sets cancelled_at when update_order_status → cancelled', async () => {
    mockQueryOne
      .mockResolvedValueOnce(
        proposed('update_order_status', { orderId: 'o1', newStatus: 'cancelled', awbNumber: null }) as any
      )
      .mockResolvedValueOnce({ id: 'o1', order_number: 'ORD-1', status: 'cancelled', awb_number: null } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    expect((await res.json()).result.status).toBe('cancelled')
  })

  it('returns 500 when update_order_status target not found', async () => {
    mockQueryOne
      .mockResolvedValueOnce(
        proposed('update_order_status', { orderId: 'missing', newStatus: 'confirmed', awbNumber: null }) as any
      )
      .mockResolvedValueOnce(null)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Order not found')
  })
})
