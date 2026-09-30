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
      proposed('export_gstr1', {
        month: 'JAN',
        from: '2099-01-01',
        to: '2099-01-31',
        format: 'csv',
        rowCount: 3,
      }) as any
    )
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
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
      proposed('export_gstr1', {
        month: 'JAN',
        from: '2099-01-01',
        to: '2099-01-31',
        format: 'json',
        rowCount: 5,
      }) as any
    )
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
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
      proposed('export_gstr1', {
        month: 'JAN',
        from: '2099-01-01',
        to: '2099-01-31',
        format: 'json',
        rowCount: 0,
      }) as any
    )
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'gst service down' }),
    }) as any
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/gst service down/)
  })

  // ── create_quotation ──────────────────────────────────────────────────

  it('returns 500 when create_quotation missing items', async () => {
    mockQueryOne.mockResolvedValueOnce(proposed('create_quotation', { items: [] }) as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/items missing/)
  })

  it('returns 500 when create_quotation transaction throws', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('create_quotation', {
        consignee_email: 'c@x.com',
        consignee_name: 'C',
        consignee_addr1: 'a1',
        consignee_city: 'city',
        consignee_state: 'CG',
        items: [
          {
            description: 'X',
            quantity: 1,
            rate: 100,
            discount_pct: 0,
            gst_rate: 18,
            unit: 'PCS',
            product_id: 'p1',
            amount: 100,
          },
        ],
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
        consignee_email: 'c@x.com',
        consignee_name: 'C',
        consignee_addr1: 'a1',
        consignee_city: 'city',
        consignee_state: 'CG',
        items: [
          {
            description: 'X',
            quantity: 2,
            rate: 100,
            discount_pct: 0,
            gst_rate: 18,
            unit: 'PCS',
            product_id: 'p1',
            amount: 200,
          },
        ],
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
        quoteNumber: 'QT/1',
        toEmail: 'x@y.com',
        consigneeName: 'A',
        totalAmount: 100,
        viewToken: 't',
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
