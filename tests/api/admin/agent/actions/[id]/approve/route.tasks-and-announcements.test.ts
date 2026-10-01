import { describe, it, expect, vi, beforeEach } from 'vitest'
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

import { POST } from '@/app/api/(admin)/admin/agent/actions/[id]/approve/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query, queryOne, queryMany, withTransaction, getClient } from '@/lib/shared/db'
import { sendProductAnnouncementEmail, transporter } from '@/lib/email'
import { sendAuditedMail } from '@/lib/shared/mail-audit'
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

// ── Tests ──────────────────────────────────────────────────────────────────

describe('POST /api/admin/agent/actions/[id]/approve (part 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rowCount: 1 } as any)
  })

  // ── remove_customer_tag ───────────────────────────────────────────────

  it('executes remove_customer_tag successfully', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'remove_customer_tag',
      payload: { customerId: 'cust-1', tagSlug: 'vip' },
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect((await res.json()).result.tag).toBe('vip')
  })

  it('returns 500 when remove_customer_tag customerId missing', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'remove_customer_tag',
      payload: { customerId: '', tagSlug: 'vip' },
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/customerId and tagSlug required/)
  })

  // ── create_customer_task ──────────────────────────────────────────────

  it('executes create_customer_task successfully', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID,
        admin_id: ADMIN.adminId,
        conversation_id: 'conv-1',
        kind: 'create_customer_task',
        payload: {
          customerId: 'cust-1',
          title: 'Call back',
          dueAt: '2025-07-01',
          assignedToAdminId: null,
          priority: 'high',
        },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce({ id: 'task-1' } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.taskId).toBe('task-1')
    expect(body.result.priority).toBe('high')
  })

  it('returns 500 when create_customer_task customerId missing', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'create_customer_task',
      payload: { customerId: '', title: 'Follow up', dueAt: null, assignedToAdminId: null, priority: 'medium' },
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/customerId and title required/)
  })

  // ── close_customer_task ───────────────────────────────────────────────

  it('returns 500 when close_customer_task taskId missing', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'close_customer_task',
      payload: { taskId: '', resolution: 'done' },
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('taskId required')
  })

  it('executes close_customer_task successfully', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID,
        admin_id: ADMIN.adminId,
        conversation_id: 'conv-1',
        kind: 'close_customer_task',
        payload: { taskId: 'task-1', resolution: 'Issue resolved' },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce({
        id: 'task-1',
        user_id: 'cust-1',
        title: 'Follow up',
        status: 'open',
        description: null,
      } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.taskId).toBe('task-1')
  })

  it('returns 500 when close_customer_task task not found', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID,
        admin_id: ADMIN.adminId,
        conversation_id: 'conv-1',
        kind: 'close_customer_task',
        payload: { taskId: 'bad-id', resolution: 'done' },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce(null)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Task not found')
  })

  it('returns 500 when close_customer_task task already completed', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID,
        admin_id: ADMIN.adminId,
        conversation_id: 'conv-1',
        kind: 'close_customer_task',
        payload: { taskId: 'task-1', resolution: 'done' },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce({
        id: 'task-1',
        user_id: 'cust-1',
        title: 'Follow up',
        status: 'completed',
        description: null,
      } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/already completed/)
  })

  // ── create_tag_definition ─────────────────────────────────────────────

  it('returns 500 when create_tag_definition slug missing', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'create_tag_definition',
      payload: { slug: '', color: 'blue' },
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('slug required')
  })

  it('executes create_tag_definition successfully', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID,
        admin_id: ADMIN.adminId,
        conversation_id: 'conv-1',
        kind: 'create_tag_definition',
        payload: { slug: 'enterprise', color: '#FF5733' },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce(null) // max sort_order

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.slug).toBe('enterprise')
  })

  // ── pay_payable ───────────────────────────────────────────────────────

  it('returns 500 when pay_payable has invalid payableId/amount', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'pay_payable',
      payload: {
        payableId: '',
        expenseNumber: 'EXP-1',
        supplierName: 'Vendor',
        amount: 0,
        paymentMode: 'cash',
        paidAt: '2025-01-01',
        transactionRef: null,
      },
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/invalid payableId\/amount/)
  })

  it('returns 500 when pay_payable amount is negative', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'pay_payable',
      payload: {
        payableId: 'pay-1',
        expenseNumber: 'EXP-1',
        supplierName: 'Vendor',
        amount: -100,
        paymentMode: 'cash',
        paidAt: '2025-01-01',
        transactionRef: null,
      },
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/invalid payableId\/amount/)
  })

  // ── export_gstr1 ──────────────────────────────────────────────────────

  it('returns 500 when export_gstr1 from/to missing', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'export_gstr1',
      payload: { month: 'JUN', from: '', to: '', format: 'json', rowCount: 0 },
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('from/to missing in payload')
  })

  // ── create_pickup_request ─────────────────────────────────────────────

  it('returns 500 when create_pickup_request orderIds empty', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'create_pickup_request',
      payload: { orderIds: [], pickupDate: '2025-07-01', orderCount: 0 },
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('orderIds missing')
  })

  it('returns 500 when create_pickup_request pickupDate invalid format', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'create_pickup_request',
      payload: { orderIds: ['order-1'], pickupDate: 'tomorrow', orderCount: 1 },
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('invalid pickupDate')
  })

  // ── send_product_announcement_email (all_opted_in / recent_buyers) ───

  it('executes product announcement for all_opted_in audience', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'send_product_announcement_email',
      payload: {
        productIds: ['pid-1'],
        audience: 'all_opted_in',
        testEmail: null,
        subject: 'New products!',
        intro: 'Check it out',
      },
      status: 'proposed',
    } as any)
    mockQueryMany
      .mockResolvedValueOnce([
        { id: 'pid-1', name: 'Bolt', slug: 'bolt', price: '100', short_description: null, primary_image_url: null },
      ] as any) // products
      .mockResolvedValueOnce([
        { email: 'a@example.com', name: 'Alice' },
        { email: 'b@example.com', name: 'Bob' },
      ] as any) // recipients
    vi.mocked(sendProductAnnouncementEmail).mockResolvedValue({ success: true } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.audience).toBe('all_opted_in')
    expect(body.result.sent).toBe(2)
  })

  it('executes product announcement for recent_buyers audience', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'send_product_announcement_email',
      payload: {
        productIds: ['pid-1'],
        audience: 'recent_buyers',
        testEmail: null,
        subject: 'Hot deals',
        intro: 'Restock alert',
      },
      status: 'proposed',
    } as any)
    mockQueryMany
      .mockResolvedValueOnce([
        { id: 'pid-1', name: 'Nut', slug: 'nut', price: '50', short_description: null, primary_image_url: null },
      ] as any)
      .mockResolvedValueOnce([{ email: 'c@example.com', name: 'Carol' }] as any)
    vi.mocked(sendProductAnnouncementEmail).mockResolvedValue({ success: true } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect((await res.json()).result.audience).toBe('recent_buyers')
  })

  it('returns 500 when no active products resolved for product announcement', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'send_product_announcement_email',
      payload: { productIds: ['pid-bad'], audience: 'test_only', testEmail: 'x@y.com', subject: 'Hi', intro: 'Hey' },
      status: 'proposed',
    } as any)
    mockQueryMany.mockResolvedValueOnce([] as any) // no products found

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('No active products resolved')
  })
})
