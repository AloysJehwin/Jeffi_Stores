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

import { POST } from '@/app/api/admin/agent/actions/[id]/approve/route'
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

  // ── toggle_marketing_opt_out ──────────────────────────────────────────────

  it('toggle_marketing_opt_out missing customerId', async () => {
    mockQueryOne.mockResolvedValueOnce(action('toggle_marketing_opt_out', { customerId: '', optOut: true }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  it('toggle_marketing_opt_out opt out success', async () => {
    primeAction(action('toggle_marketing_opt_out', { customerId: 'u1', optOut: true }), {
      id: 'u1',
      email: 'a@b.com',
      marketing_opt_out: true,
    })
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
    primeAction(action('create_tag_definition', { slug: 'vip', color: 'gold' }), { sort_order: 20 })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('create_tag_definition duplicate', async () => {
    primeAction(action('create_tag_definition', { slug: 'vip', color: '' }), { sort_order: 10 })
    mockQuery.mockImplementation(async (sql: any) =>
      String(sql).includes('customer_tag_definitions')
        ? Promise.reject({ code: '23505' })
        : ({ rows: [], rowCount: 1 } as any)
    )
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/already exists/i)
  })

  it('create_tag_definition insert throws', async () => {
    primeAction(action('create_tag_definition', { slug: 'vip', color: 'red' }), null)
    mockQuery.mockImplementation(async (sql: any) =>
      String(sql).includes('customer_tag_definitions')
        ? Promise.reject(new Error('db fail'))
        : ({ rows: [], rowCount: 1 } as any)
    )
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/db fail/i)
  })

  // ── create_pickup_request ─────────────────────────────────────────────────

  it('create_pickup_request orderIds missing', async () => {
    mockQueryOne.mockResolvedValueOnce(
      action('create_pickup_request', { orderIds: [], pickupDate: '2026-01-01', orderCount: 0 })
    )
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  it('create_pickup_request invalid date', async () => {
    mockQueryOne.mockResolvedValueOnce(
      action('create_pickup_request', { orderIds: ['o1'], pickupDate: 'bad', orderCount: 1 })
    )
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/invalid pickupdate/i)
  })

  it('create_pickup_request success', async () => {
    mockQueryOne.mockResolvedValueOnce(
      action('create_pickup_request', { orderIds: ['o1'], pickupDate: '2026-01-01', orderCount: 1 })
    )
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ pickupId: 'pk1', pickupDate: '2026-01-01', orderCount: 1, awbs: ['A1'] }),
    } as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('create_pickup_request upstream failure', async () => {
    mockQueryOne.mockResolvedValueOnce(
      action('create_pickup_request', { orderIds: ['o1'], pickupDate: '2026-01-01', orderCount: 1 })
    )
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
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ total: 5, synced: 4, errors: [], rvp: { received: 1 } }),
    } as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
    delete process.env.CRON_SECRET
  })

  it('sync_delhivery_statuses upstream failure with json parse throw', async () => {
    process.env.CRON_SECRET = 'secret'
    mockQueryOne.mockResolvedValueOnce(action('sync_delhivery_statuses', {}))
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('x')
      },
    } as any)
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
    mockQueryOne.mockResolvedValueOnce(
      action('pay_payable', {
        payableId: 'py1',
        expenseNumber: 'E1',
        supplierName: 'S',
        amount: 100,
        paymentMode: 'cash',
        paidAt: '2026-01-01',
        transactionRef: 'ref1',
      })
    )
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ new_status: 'paid', total_paid: 100 }) } as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('pay_payable upstream failure', async () => {
    mockQueryOne.mockResolvedValueOnce(
      action('pay_payable', {
        payableId: 'py1',
        expenseNumber: 'E1',
        supplierName: 'S',
        amount: 100,
        paymentMode: 'cash',
        paidAt: '2026-01-01',
        transactionRef: null,
      })
    )
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'bad' }) } as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('bad')
  })

  // ── export_gstr1 ──────────────────────────────────────────────────────────

  it('export_gstr1 missing from/to', async () => {
    mockQueryOne.mockResolvedValueOnce(
      action('export_gstr1', { month: 'Jan', from: '', to: '', format: 'json', rowCount: 0 })
    )
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  it('export_gstr1 json success', async () => {
    mockQueryOne.mockResolvedValueOnce(
      action('export_gstr1', { month: 'Jan', from: '2026-01-01', to: '2026-01-31', format: 'json', rowCount: 3 })
    )
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ summary: {}, b2b: [1], b2c: [], hsnSummary: [] }) } as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('export_gstr1 csv success', async () => {
    mockQueryOne.mockResolvedValueOnce(
      action('export_gstr1', { month: 'Jan', from: '2026-01-01', to: '2026-01-31', format: 'csv', rowCount: 3 })
    )
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => 'a,b\n1,2' } as any)
    const res = await POST(makeReq(), params)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.result.format).toBe('csv')
    expect(body.result.contentBase64).toBeTruthy()
  })

  it('export_gstr1 upstream failure with json error', async () => {
    mockQueryOne.mockResolvedValueOnce(
      action('export_gstr1', { month: 'Jan', from: '2026-01-01', to: '2026-01-31', format: 'json', rowCount: 3 })
    )
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'gst boom' }) } as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('gst boom')
  })

  it('export_gstr1 upstream failure json parse throws', async () => {
    mockQueryOne.mockResolvedValueOnce(
      action('export_gstr1', { month: 'Jan', from: '2026-01-01', to: '2026-01-31', format: 'csv', rowCount: 3 })
    )
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => {
        throw new Error('x')
      },
    } as any)
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
    await new Promise(r => setTimeout(r, 0))
  })

  it('customer actions swallow logActivity rejection (add_customer_tag)', async () => {
    vi.mocked(activity.logActivity).mockRejectedValue(new Error('log down'))
    mockQueryOne.mockResolvedValueOnce(action('add_customer_tag', { customerId: 'u1', tagSlug: 'vip' }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
    await new Promise(r => setTimeout(r, 0))
  })

  it('customer actions swallow logActivity rejection (remove_customer_tag)', async () => {
    vi.mocked(activity.logActivity).mockRejectedValue(new Error('log down'))
    mockQueryOne.mockResolvedValueOnce(action('remove_customer_tag', { customerId: 'u1', tagSlug: 'vip' }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
    await new Promise(r => setTimeout(r, 0))
  })

  it('customer actions swallow logActivity rejection (create_customer_task)', async () => {
    vi.mocked(activity.logActivity).mockRejectedValue(new Error('log down'))
    primeAction(
      action('create_customer_task', {
        customerId: 'u1',
        title: 'T',
        dueAt: null,
        assignedToAdminId: null,
        priority: 'high',
      }),
      { id: 'task-1' }
    )
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
    await new Promise(r => setTimeout(r, 0))
  })

  it('customer actions swallow logActivity rejection (close_customer_task)', async () => {
    vi.mocked(activity.logActivity).mockRejectedValue(new Error('log down'))
    primeAction(action('close_customer_task', { taskId: 't1', resolution: 'done' }), {
      id: 't1',
      user_id: 'u1',
      title: 'T',
      status: 'open',
      description: null,
    })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
    await new Promise(r => setTimeout(r, 0))
  })

  it('customer actions swallow logActivity rejection (toggle_marketing_opt_out)', async () => {
    vi.mocked(activity.logActivity).mockRejectedValue(new Error('log down'))
    primeAction(action('toggle_marketing_opt_out', { customerId: 'u1', optOut: true }), {
      id: 'u1',
      email: 'a@b.com',
      marketing_opt_out: true,
    })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
    await new Promise(r => setTimeout(r, 0))
  })

  it('call_admin_api json+text both throw → data null (text catch closure)', async () => {
    mockQueryOne.mockResolvedValueOnce(
      action('call_admin_api', { method: 'POST', path: '/api/admin/products', body: null })
    )
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('no json')
      },
      text: async () => {
        throw new Error('no text')
      },
    } as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('create_pickup_request internal api text fallback (callInternalApi json throws)', async () => {
    mockQueryOne.mockResolvedValueOnce(
      action('create_pickup_request', { orderIds: ['o1'], pickupDate: '2026-01-01', orderCount: 1 })
    )
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('no json')
      },
      text: async () => {
        throw new Error('no text')
      },
    } as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })
})
