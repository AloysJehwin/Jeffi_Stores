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
import { sendProductAnnouncementEmail, transporter } from '@/lib/email'
import { logStockMovement } from '@/lib/inventory'

// ── Helpers ────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'admin-uuid-1', role: 'super_admin', scopes: ['agent'] }
const ACTION_ID = 'action-uuid-1'

function makeReq(id = ACTION_ID) {
  return new NextRequest(`http://localhost/api/admin/agent/actions/${id}/approve`, {
    method: 'POST',
    headers: { cookie: 'admin_token=valid' },
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
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
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
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'create_quotation',
      payload: {
        customerEmail: 'buyer@corp.com',
        consigneeName: 'Corp Ltd',
        notes: null,
        items: [{ productId: 'p1', name: 'Bolt M6', sku: 'BM6', hsnCode: null, gstRate: 18, quantity: 10, unitPrice: 50, lineAmount: 500 }],
      },
      status: 'proposed',
    } as any)

    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ max_seq: null }] })           // seq lookup
        .mockResolvedValueOnce({ rows: [{ id: 'qt-1', quote_number: 'QT/25-26/JUN/1', view_token: 'tok-xyz' }] }) // INSERT quotation
        .mockResolvedValueOnce({ rows: [] }),                            // INSERT item
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
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'create_quotation',
      payload: {
        customerEmail: 'a@b.com', consigneeName: 'Alice', notes: null,
        items: [{ productId: 'p1', name: 'Bolt', sku: 'B', hsnCode: null, gstRate: 0, quantity: 1, unitPrice: 100, lineAmount: 100 }],
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
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
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
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
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
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
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
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
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
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
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
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'send_mailer_broadcast',
      payload: { audience: 'all_opted_in', testEmail: null, subject: 'Newsletter', body: '<p>Hi {firstName}</p>', fromName: 'Store' },
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
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'send_mailer_broadcast',
      payload: { audience: 'recent_buyers', testEmail: null, subject: 'Sale!', body: '<p>Hello</p>', fromName: 'Store' },
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
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'send_mailer_broadcast',
      payload: { audience: 'test_only', testEmail: 'a@b.com', subject: 'Hi', body: '<p>Hey</p>', fromName: 'Store' },
      status: 'proposed',
    } as any)
    vi.mocked(transporter.sendMail).mockRejectedValue(new Error('SMTP error'))

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/sends failed/)
  })

  // ── generate_personalized_coupon ──────────────────────────────────────

  it('returns 500 when generate_personalized_coupon missing required fields', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'generate_personalized_coupon',
      payload: { userId: '', discountType: '', discountValue: 0, daysValid: 30, campaign: 'SUMMER', validUntil: '2025-12-31' },
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Missing required fields/)
  })

  it('executes generate_personalized_coupon successfully', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
        kind: 'generate_personalized_coupon',
        payload: { userId: 'user-1', customerEmail: 'u@example.com', discountType: 'percentage', discountValue: 15, daysValid: 30, campaign: 'SUMMER', validUntil: '2025-12-31' },
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
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
        kind: 'create_product',
        payload: { name: 'Bolt', sku: 'BLT-01', slug: 'bolt', basePrice: 100, brandId: null, categoryId: null, shortDescription: null, weightGrams: 50, gstPercentage: 18 },
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
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
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
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
        kind: 'update_product',
        payload: { productId: 'bad-id', changes: { name: 'X' } },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce(null)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Product not found')
  })

  // ── adjust_inventory ──────────────────────────────────────────────────

  it('returns 500 for invalid delta (0) in adjust_inventory', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'adjust_inventory',
      payload: { productId: 'prod-1', delta: 0, reason: 'count' },
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Invalid delta')
  })

  it('returns 500 for non-integer delta in adjust_inventory', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'adjust_inventory',
      payload: { productId: 'prod-1', delta: 1.5, reason: 'partial' },
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Invalid delta')
  })

  it('executes adjust_inventory successfully', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'adjust_inventory',
      payload: { productId: 'prod-1', delta: 5, reason: 'restock' },
      status: 'proposed',
    } as any)

    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })                              // BEGIN
        .mockResolvedValueOnce({ rows: [{ inventory_quantity: 10 }] })    // SELECT FOR UPDATE
        .mockResolvedValueOnce({ rows: [] })                              // UPDATE
        .mockResolvedValueOnce({ rows: [] })                              // COMMIT
        .mockResolvedValue({ rows: [] }),                                 // any extra
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValueOnce(mockClient as any)
    vi.mocked(logStockMovement).mockResolvedValue(undefined)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.delta).toBe(5)
    expect(body.result.previous).toBe(10)
    expect(body.result.current).toBe(15)
  })

  it('returns 500 when adjust_inventory product not found', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'adjust_inventory',
      payload: { productId: 'bad-id', delta: 1, reason: 'test' },
      status: 'proposed',
    } as any)

    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })    // BEGIN
        .mockResolvedValueOnce({ rows: [] })    // SELECT FOR UPDATE — empty = not found
        .mockResolvedValueOnce({ rows: [] }),   // ROLLBACK
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValueOnce(mockClient as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Product not found')
  })

  it('returns 500 when adjust_inventory would drop below zero', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'adjust_inventory',
      payload: { productId: 'prod-1', delta: -50, reason: 'correction' },
      status: 'proposed',
    } as any)

    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })                             // BEGIN
        .mockResolvedValueOnce({ rows: [{ inventory_quantity: 3 }] })   // SELECT FOR UPDATE
        .mockResolvedValueOnce({ rows: [] }),                            // ROLLBACK
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValueOnce(mockClient as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/drop stock to/)
  })

  // ── set_product_featured ──────────────────────────────────────────────

  it('returns 500 when set_product_featured limit reached', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
        kind: 'set_product_featured',
        payload: { productId: 'prod-1', featured: true, limit: 3 },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce({ n: 3 } as any) // already 3 featured

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Featured limit/)
  })

  it('executes set_product_featured (unfeature) successfully', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
        kind: 'set_product_featured',
        payload: { productId: 'prod-1', featured: false, limit: 6 },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce({ id: 'prod-1', name: 'Bolt', is_featured: false } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect((await res.json()).result.is_featured).toBe(false)
  })

  it('returns 500 when set_product_featured product not found', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
        kind: 'set_product_featured',
        payload: { productId: 'bad-id', featured: false, limit: 6 },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce(null) // UPDATE returns null

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Product not found')
  })

  // ── create_brand ──────────────────────────────────────────────────────

  it('executes create_brand successfully', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
        kind: 'create_brand',
        payload: { name: 'Acme', slug: 'acme', logoUrl: null },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce(null)  // no dup
      .mockResolvedValueOnce({ id: 'brand-1', name: 'Acme', slug: 'acme', logo_url: null, is_active: true } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect((await res.json()).result.slug).toBe('acme')
  })

  it('returns 500 when create_brand slug already exists', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
        kind: 'create_brand',
        payload: { name: 'Acme', slug: 'acme', logoUrl: null },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce({ id: 'existing' } as any) // dup found

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/already exists/)
  })

  // ── create_category ───────────────────────────────────────────────────

  it('returns 500 when create_category name or slug missing', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'create_category',
      payload: { name: '', slug: '', parentId: null },
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/name and slug required/)
  })

  it('executes create_category successfully (no parent)', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
        kind: 'create_category',
        payload: { name: 'Fasteners', slug: 'fasteners', parentId: null },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce(null) // no dup slug
      .mockResolvedValueOnce({ id: 'cat-1', name: 'Fasteners', slug: 'fasteners', parent_id: null, is_active: true } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect((await res.json()).result.slug).toBe('fasteners')
  })

  it('returns 500 when create_category parent not found', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
        kind: 'create_category',
        payload: { name: 'Bolts', slug: 'bolts', parentId: 'nonexistent-parent' },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce(null) // parent lookup returns null

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Parent category not found')
  })

  it('returns 500 when create_category slug already exists', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
        kind: 'create_category',
        payload: { name: 'Bolts', slug: 'bolts', parentId: null },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce({ id: 'dup' } as any) // dup slug

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/already exists/)
  })

  // ── add_customer_tag ──────────────────────────────────────────────────

  it('executes add_customer_tag successfully', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'add_customer_tag',
      payload: { customerId: 'cust-1', tagSlug: 'vip' },
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.tag).toBe('vip')
  })

  it('returns 500 when add_customer_tag customerId missing', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'add_customer_tag',
      payload: { customerId: '', tagSlug: 'vip' },
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/customerId and tagSlug required/)
  })

  // ── remove_customer_tag ───────────────────────────────────────────────

  it('executes remove_customer_tag successfully', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
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
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
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
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
        kind: 'create_customer_task',
        payload: { customerId: 'cust-1', title: 'Call back', dueAt: '2025-07-01', assignedToAdminId: null, priority: 'high' },
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
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
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
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
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
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
        kind: 'close_customer_task',
        payload: { taskId: 'task-1', resolution: 'Issue resolved' },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce({ id: 'task-1', user_id: 'cust-1', title: 'Follow up', status: 'open', description: null } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.taskId).toBe('task-1')
  })

  it('returns 500 when close_customer_task task not found', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
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
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
        kind: 'close_customer_task',
        payload: { taskId: 'task-1', resolution: 'done' },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce({ id: 'task-1', user_id: 'cust-1', title: 'Follow up', status: 'completed', description: null } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/already completed/)
  })

  // ── create_tag_definition ─────────────────────────────────────────────

  it('returns 500 when create_tag_definition slug missing', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
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
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
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
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'pay_payable',
      payload: { payableId: '', expenseNumber: 'EXP-1', supplierName: 'Vendor', amount: 0, paymentMode: 'cash', paidAt: '2025-01-01', transactionRef: null },
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/invalid payableId\/amount/)
  })

  it('returns 500 when pay_payable amount is negative', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'pay_payable',
      payload: { payableId: 'pay-1', expenseNumber: 'EXP-1', supplierName: 'Vendor', amount: -100, paymentMode: 'cash', paidAt: '2025-01-01', transactionRef: null },
      status: 'proposed',
    } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/invalid payableId\/amount/)
  })

  // ── export_gstr1 ──────────────────────────────────────────────────────

  it('returns 500 when export_gstr1 from/to missing', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
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
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
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
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
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
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'send_product_announcement_email',
      payload: { productIds: ['pid-1'], audience: 'all_opted_in', testEmail: null, subject: 'New products!', intro: 'Check it out' },
      status: 'proposed',
    } as any)
    mockQueryMany
      .mockResolvedValueOnce([{ id: 'pid-1', name: 'Bolt', slug: 'bolt', price: '100', short_description: null, primary_image_url: null }] as any) // products
      .mockResolvedValueOnce([{ email: 'a@example.com', name: 'Alice' }, { email: 'b@example.com', name: 'Bob' }] as any) // recipients
    vi.mocked(sendProductAnnouncementEmail).mockResolvedValue({ success: true } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.audience).toBe('all_opted_in')
    expect(body.result.sent).toBe(2)
  })

  it('executes product announcement for recent_buyers audience', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'send_product_announcement_email',
      payload: { productIds: ['pid-1'], audience: 'recent_buyers', testEmail: null, subject: 'Hot deals', intro: 'Restock alert' },
      status: 'proposed',
    } as any)
    mockQueryMany
      .mockResolvedValueOnce([{ id: 'pid-1', name: 'Nut', slug: 'nut', price: '50', short_description: null, primary_image_url: null }] as any)
      .mockResolvedValueOnce([{ email: 'c@example.com', name: 'Carol' }] as any)
    vi.mocked(sendProductAnnouncementEmail).mockResolvedValue({ success: true } as any)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect((await res.json()).result.audience).toBe('recent_buyers')
  })

  it('returns 500 when no active products resolved for product announcement', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
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
