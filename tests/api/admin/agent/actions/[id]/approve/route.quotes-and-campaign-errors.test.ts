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

  // ── create_quotation ──────────────────────────────────────────────────

  it('returns 500 when create_quotation items missing', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'create_quotation',
      payload: { customerEmail: 'a@b.com', consigneeName: 'Alice', notes: null, items: [] },
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('items missing')
  })

  it('executes create_quotation successfully', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'create_quotation',
      payload: {
        customerEmail: 'buyer@corp.com',
        consigneeName: 'Corp Ltd',
        notes: null,
        items: [
          {
            productId: 'p1',
            name: 'Bolt M6',
            sku: 'BM6',
            hsnCode: null,
            gstRate: 18,
            quantity: 10,
            unitPrice: 50,
            lineAmount: 500,
          },
        ],
      },
      status: 'proposed',
    } as any)

    const mockClient = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ max_seq: null }] }) // seq lookup
        .mockResolvedValueOnce({ rows: [{ id: 'qt-1', quote_number: 'QT/25-26/JUN/1', view_token: 'tok-xyz' }] }) // INSERT quotation
        .mockResolvedValueOnce({ rows: [] }), // INSERT item
    }
    mockWithTransaction.mockImplementation(async (fn: any) => fn(mockClient))

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.quotationId).toBe('qt-1')
    expect(body.result.quoteNumber).toBe('QT/25-26/JUN/1')
  })

  it('returns 500 when create_quotation transaction throws', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'create_quotation',
      payload: {
        customerEmail: 'a@b.com',
        consigneeName: 'Alice',
        notes: null,
        items: [
          {
            productId: 'p1',
            name: 'Bolt',
            sku: 'B',
            hsnCode: null,
            gstRate: 0,
            quantity: 1,
            unitPrice: 100,
            lineAmount: 100,
          },
        ],
      },
      status: 'proposed',
    } as any)
    mockWithTransaction.mockRejectedValueOnce(new Error('DB error'))

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toContain('DB error')
  })

  // ── update_campaign_template ──────────────────────────────────────────

  it('returns 500 when update_campaign_template campaignKind missing', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'update_campaign_template',
      payload: { campaignKind: '', newSubject: 'New Subject', newBody: null },
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('campaignKind missing')
  })

  it('returns 500 when update_campaign_template has no fields to update', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'update_campaign_template',
      payload: { campaignKind: 'welcome', newSubject: null, newBody: null },
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('No fields to update')
  })

  it('executes update_campaign_template successfully', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID,
        admin_id: ADMIN.adminId,
        conversation_id: 'conv-1',
        kind: 'update_campaign_template',
        payload: { campaignKind: 'welcome', newSubject: 'Hello!', newBody: null },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce({ kind: 'welcome', name: 'Welcome' } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.kind).toBe('welcome')
    expect(body.result.subjectChanged).toBe(true)
  })

  it('returns 500 when update_campaign_template campaign not found', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID,
        admin_id: ADMIN.adminId,
        conversation_id: 'conv-1',
        kind: 'update_campaign_template',
        payload: { campaignKind: 'nonexistent', newSubject: 'Hi', newBody: null },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce(null)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Campaign not found')
  })

  // ── send_mailer_broadcast ─────────────────────────────────────────────

  it('returns 500 when send_mailer_broadcast subject/body missing', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'send_mailer_broadcast',
      payload: { audience: 'test_only', testEmail: 'a@b.com', subject: '', body: '', fromName: 'Store' },
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/subject and body required/)
  })

  it('executes send_mailer_broadcast for all_opted_in audience', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'send_mailer_broadcast',
      payload: {
        audience: 'all_opted_in',
        testEmail: null,
        subject: 'Newsletter',
        body: '<p>Hi {firstName}</p>',
        fromName: 'Store',
      },
      status: 'proposed',
    } as any)
    mockQueryMany.mockResolvedValueOnce([
      { email: 'a@example.com', name: 'Alice' },
      { email: 'b@example.com', name: 'Bob' },
    ] as any)
    vi.mocked(transporter.sendMail).mockResolvedValue({} as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.sent).toBe(2)
    expect(body.result.audience).toBe('all_opted_in')
  })

  it('executes send_mailer_broadcast for recent_buyers audience', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'send_mailer_broadcast',
      payload: {
        audience: 'recent_buyers',
        testEmail: null,
        subject: 'Sale!',
        body: '<p>Hello</p>',
        fromName: 'Store',
      },
      status: 'proposed',
    } as any)
    mockQueryMany.mockResolvedValueOnce([{ email: 'c@example.com', name: 'Carol' }] as any)
    vi.mocked(transporter.sendMail).mockResolvedValue({} as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect((await res.json()).result.sent).toBe(1)
  })

  it('returns 500 when all sends fail in send_mailer_broadcast', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'send_mailer_broadcast',
      payload: { audience: 'test_only', testEmail: 'a@b.com', subject: 'Hi', body: '<p>Hey</p>', fromName: 'Store' },
      status: 'proposed',
    } as any)
    vi.mocked(sendAuditedMail).mockRejectedValue(new Error('SMTP error'))

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/sends failed/)
  })

  // ── generate_personalized_coupon ──────────────────────────────────────

  it('returns 500 when generate_personalized_coupon missing required fields', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID,
      admin_id: ADMIN.adminId,
      conversation_id: 'conv-1',
      kind: 'generate_personalized_coupon',
      payload: {
        userId: '',
        discountType: '',
        discountValue: 0,
        daysValid: 30,
        campaign: 'SUMMER',
        validUntil: '2025-12-31',
      },
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Missing required fields/)
  })

  it('executes generate_personalized_coupon successfully', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID,
        admin_id: ADMIN.adminId,
        conversation_id: 'conv-1',
        kind: 'generate_personalized_coupon',
        payload: {
          userId: 'user-1',
          customerEmail: 'u@example.com',
          discountType: 'percentage',
          discountValue: 15,
          daysValid: 30,
          campaign: 'SUMMER',
          validUntil: '2025-12-31',
        },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce({ id: 'coupon-2', code: 'SUMMER-AB1234' } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.userId).toBe('user-1')
    expect(body.result.discountValue).toBe(15)
  })

  // ── create_product (dup SKU) ──────────────────────────────────────────

  it('returns 500 when create_product has duplicate SKU', async () => {
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
      .mockResolvedValueOnce({ id: 'existing-prod' } as any) // dup check finds existing

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/already exists/)
  })

  // ── update_product ────────────────────────────────────────────────────

  it('executes update_product successfully with valid field', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID,
        admin_id: ADMIN.adminId,
        conversation_id: 'conv-1',
        kind: 'update_product',
        payload: { productId: 'prod-1', changes: { name: 'Updated Bolt', is_active: true } },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce({ id: 'prod-1', name: 'Updated Bolt', is_active: true, is_featured: false } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect((await res.json()).result.name).toBe('Updated Bolt')
  })

  it('returns 500 when update_product product not found', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID,
        admin_id: ADMIN.adminId,
        conversation_id: 'conv-1',
        kind: 'update_product',
        payload: { productId: 'bad-id', changes: { name: 'X' } },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce(null)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Product not found')
  })
})
