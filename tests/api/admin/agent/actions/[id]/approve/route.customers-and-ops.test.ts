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

  // ── customer tag/task/note ────────────────────────────────────────────

  it('returns 500 when add_customer_note missing customerId', async () => {
    mockQueryOne.mockResolvedValueOnce(proposed('add_customer_note', { customerId: '', body: 'hi' }) as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/customerId and body required/)
  })

  it('executes add_customer_tag successfully', async () => {
    mockQueryOne.mockResolvedValueOnce(proposed('add_customer_tag', { customerId: 'c1', tagSlug: 'VIP' }) as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    expect((await res.json()).result.tag).toBe('vip')
  })

  it('returns 500 when add_customer_tag missing tag', async () => {
    mockQueryOne.mockResolvedValueOnce(proposed('add_customer_tag', { customerId: 'c1', tagSlug: '' }) as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/tagSlug required/)
  })

  it('executes remove_customer_tag successfully', async () => {
    mockQueryOne.mockResolvedValueOnce(proposed('remove_customer_tag', { customerId: 'c1', tagSlug: 'vip' }) as any)
    mockQuery.mockResolvedValueOnce({ rowCount: 1 } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    expect((await res.json()).result.removed).toBe(1)
  })

  it('returns 500 when create_customer_task missing title', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('create_customer_task', {
        customerId: 'c1',
        title: '',
        dueAt: null,
        assignedToAdminId: null,
        priority: 'high',
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
          customerId: 'c1',
          title: 'call',
          dueAt: null,
          assignedToAdminId: null,
          priority: 'weird',
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
    mockQueryOne.mockResolvedValueOnce(proposed('close_customer_task', { taskId: '', resolution: null }) as any)
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
    mockQueryOne.mockResolvedValueOnce(proposed('toggle_marketing_opt_out', { customerId: '', optOut: true }) as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/customerId required/)
  })

  // ── create_tag_definition ─────────────────────────────────────────────

  it('returns 500 when create_tag_definition missing slug', async () => {
    mockQueryOne.mockResolvedValueOnce(proposed('create_tag_definition', { slug: '', color: 'red' }) as any)
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
      ok: true,
      status: 200,
      json: async () => ({ pickupId: 'PU-1', pickupDate: '2099-01-01', orderCount: 1, awbs: ['AWB1'] }),
    }) as any
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    expect((await res.json()).result.pickupId).toBe('PU-1')
  })

  // ── sync_delhivery_statuses ───────────────────────────────────────────

  it('executes sync_delhivery_statuses successfully', async () => {
    mockQueryOne.mockResolvedValueOnce(proposed('sync_delhivery_statuses', {}) as any)
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ total: 10, synced: 8, errors: [], rvp: { received: 2 } }),
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
      ok: false,
      status: 502,
      json: async () => ({ error: 'Delhivery down' }),
    }) as any
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Delhivery down/)
  })

  // ── pay_payable ───────────────────────────────────────────────────────

  it('returns 500 when pay_payable amount invalid', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('pay_payable', {
        payableId: 'pay-1',
        expenseNumber: 'E1',
        supplierName: 'S',
        amount: 0,
        paymentMode: 'cash',
        paidAt: '2099-01-01',
        transactionRef: null,
      }) as any
    )
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/invalid payableId\/amount/)
  })

  it('returns 500 when pay_payable upstream not ok', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('pay_payable', {
        payableId: 'pay-1',
        expenseNumber: 'E1',
        supplierName: 'S',
        amount: 500,
        paymentMode: 'cash',
        paidAt: '2099-01-01',
        transactionRef: null,
      }) as any
    )
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'already paid' }),
    }) as any
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/already paid/)
  })

  it('executes pay_payable successfully', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('pay_payable', {
        payableId: 'pay-1',
        expenseNumber: 'E1',
        supplierName: 'S',
        amount: 500,
        paymentMode: 'cash',
        paidAt: '2099-01-01',
        transactionRef: 'TX1',
      }) as any
    )
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ new_status: 'paid', total_paid: 500 }),
    }) as any
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.newStatus).toBe('paid')
  })
})
