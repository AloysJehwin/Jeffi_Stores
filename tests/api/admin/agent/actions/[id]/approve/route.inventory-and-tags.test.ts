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
vi.mock('@/lib/mail-audit', () => ({ sendAuditedMail: vi.fn() }))

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
import { sendAuditedMail } from '@/lib/mail-audit'
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

describe('POST /api/admin/agent/actions/[id]/approve (part 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rowCount: 1 } as any)
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
})
