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

// ── Tests ──────────────────────────────────────────────────────────────────

describe('POST /api/admin/agent/actions/[id]/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rowCount: 1 } as any)
  })

  // ── add_customer_note ───────────────────────────────────────────────────

  it('executes add_customer_note successfully', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
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
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
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
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
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
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
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
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'send_mailer_broadcast',
      payload: {
        audience: 'not_a_real_audience',
        testEmail: null,
        subject: 'Hi',
        body: '<p>Hello</p>',
        fromName: 'Store',
      },
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Unknown audience/)
  })

  it('executes send_mailer_broadcast for test_only audience', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'send_mailer_broadcast',
      payload: {
        audience: 'test_only',
        testEmail: 'admin@example.com',
        subject: 'Hi',
        body: '<p>Hello {firstName}</p>',
        fromName: 'Store',
      },
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
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'send_quotation_email',
      payload: {
        quoteNumber: 'QT/24-25/JAN/1',
        toEmail: 'buyer@co.com',
        consigneeName: 'Alice',
        totalAmount: 5000,
        viewToken: 'tok-abc',
      },
      status: 'proposed',
    } as any)
    vi.mocked(sendQuotationFinalizedEmail).mockResolvedValue(undefined as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect((await res.json()).result.sentTo).toBe('buyer@co.com')
  })

  it('returns 500 when send_quotation_email missing toEmail', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
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
        id: ACTION_ID,
        admin_id: ADMIN.adminId,
        conversation_id: 'conv-1',
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
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'sync_delhivery_statuses',
      payload: {},
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/CRON_SECRET not configured/)
    process.env.CRON_SECRET = savedCron
  })

  // ── create_quotation ────────────────────────────────────────────────────

  it('returns 500 when create_quotation items are missing', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'create_quotation',
      payload: { items: [] },
      status: 'proposed',
    } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/items missing/)
  })

  it('executes create_quotation successfully', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'create_quotation',
      payload: {
        consignee_email: 'b@x.com',
        consignee_name: 'Buyer',
        consignee_addr1: '1 Main',
        consignee_city: 'Raipur',
        consignee_state: 'CG',
        consignee_phone: null,
        consignee_gstin: null,
        consignee_pincode: null,
        consignee_addr2: null,
        buyer_same: true,
        buyer_name: null,
        buyer_addr1: null,
        buyer_addr2: null,
        buyer_city: null,
        buyer_state: null,
        buyer_gstin: null,
        buyer_phone: null,
        buyer_pincode: null,
        buyer_email: null,
        notes: null,
        quote_date: null,
        items: [
          {
            description: 'Bolt',
            quantity: 10,
            rate: 5,
            discount_pct: 0,
            hsn_code: '7318',
            gst_rate: 18,
            unit: 'PCS',
            buy_unit: null,
            product_id: 'pid-1',
            variant_id: null,
            sub_variant_id: null,
            amount: 50,
          },
        ],
      },
      status: 'proposed',
    } as any)
    mockWithTransaction.mockImplementation(async (fn: any) => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({ rows: [{ max_seq: null }] })
          .mockResolvedValueOnce({ rows: [{ id: 'qt-1', quote_number: 'QT/25-26/JAN/1', view_token: 'tok-1' }] })
          .mockResolvedValue({ rows: [], rowCount: 1 }),
      }
      return fn(client)
    })
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect((await res.json()).result.quoteNumber).toBe('QT/25-26/JAN/1')
  })

  // ── adjust_inventory ────────────────────────────────────────────────────

  it('returns 500 for invalid delta (zero) in adjust_inventory', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'adjust_inventory',
      payload: { productId: 'p1', delta: 0, reason: 't' },
      status: 'proposed',
    } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Invalid delta/)
  })

  it('returns 500 for non-integer delta in adjust_inventory', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'adjust_inventory',
      payload: { productId: 'p1', delta: 1.5, reason: 't' },
      status: 'proposed',
    } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Invalid delta/)
  })

  it('returns 500 when adjust_inventory product not found', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'adjust_inventory',
      payload: { productId: 'missing', delta: 5, reason: 'r' },
      status: 'proposed',
    } as any)
    mockGetClient.mockResolvedValue({
      query: vi
        .fn()
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SELECT (not found)
        .mockResolvedValueOnce(undefined), // ROLLBACK
      release: vi.fn(),
    } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Product not found/)
  })

  it('returns 500 when adjust_inventory would drop stock below 0', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'adjust_inventory',
      payload: { productId: 'p1', delta: -50, reason: 'r' },
      status: 'proposed',
    } as any)
    mockGetClient.mockResolvedValue({
      query: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [{ inventory_quantity: 10 }] })
        .mockResolvedValueOnce(undefined),
      release: vi.fn(),
    } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/drop stock/)
  })

  it('executes adjust_inventory successfully', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'adjust_inventory',
      payload: { productId: 'p1', delta: 10, reason: 'restock' },
      status: 'proposed',
    } as any)
    const mockCQ = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ inventory_quantity: 5 }] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
    mockGetClient.mockResolvedValue({ query: mockCQ, release: vi.fn() } as any)
    vi.mocked(logStockMovement).mockResolvedValue(undefined as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect((await res.json()).result.current).toBe(15)
  })

  // ── set_product_featured ────────────────────────────────────────────────

  it('returns 500 when set_product_featured exceeds limit', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID,
        admin_id: ADMIN.adminId,
        conversation_id: 'conv-1',
        kind: 'set_product_featured',
        payload: { productId: 'p1', featured: true, limit: 6 },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce({ n: 6 } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Featured limit/)
  })

  it('executes set_product_featured=true within limit', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID,
        admin_id: ADMIN.adminId,
        conversation_id: 'conv-1',
        kind: 'set_product_featured',
        payload: { productId: 'p1', featured: true, limit: 6 },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce({ n: 3 } as any)
      .mockResolvedValueOnce({ id: 'p1', name: 'Bolt', is_featured: true } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect((await res.json()).result.is_featured).toBe(true)
  })

  it('executes set_product_featured=false without limit check', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID,
        admin_id: ADMIN.adminId,
        conversation_id: 'conv-1',
        kind: 'set_product_featured',
        payload: { productId: 'p1', featured: false },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce({ id: 'p1', name: 'Bolt', is_featured: false } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect((await res.json()).result.is_featured).toBe(false)
  })

  // ── create_category ─────────────────────────────────────────────────────

  it('returns 500 when create_category name or slug missing', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'create_category',
      payload: { name: '', slug: '', parentId: null },
      status: 'proposed',
    } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/name and slug required/)
  })

  it('returns 500 when create_category parent not found', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID,
        admin_id: ADMIN.adminId,
        conversation_id: 'conv-1',
        kind: 'create_category',
        payload: { name: 'Sub', slug: 'sub', parentId: 'bad-parent' },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce(null)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Parent category not found/)
  })

  it('returns 500 when create_category slug already exists', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID,
        admin_id: ADMIN.adminId,
        conversation_id: 'conv-1',
        kind: 'create_category',
        payload: { name: 'Tools', slug: 'tools', parentId: null },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce({ id: 'existing-cat' } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/already exists/)
  })

  it('executes create_category successfully', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID,
        admin_id: ADMIN.adminId,
        conversation_id: 'conv-1',
        kind: 'create_category',
        payload: { name: 'New Cat', slug: 'new-cat', parentId: null },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'cat-1', name: 'New Cat', slug: 'new-cat', parent_id: null, is_active: true } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect((await res.json()).result.slug).toBe('new-cat')
  })
})
