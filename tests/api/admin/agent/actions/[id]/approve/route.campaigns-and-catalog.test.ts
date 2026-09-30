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

  // ── create_coupon ──────────────────────────────────────────────────────

  it('returns 500 when create_coupon insert throws unique violation', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('create_coupon', {
        code: 'DUP',
        discountType: 'flat',
        discountValue: 100,
        validUntil: null,
        minPurchaseAmount: null,
        usageLimit: null,
        description: null,
      }) as any
    )
    const err: any = new Error('unique_violation')
    err.code = '23505'
    mockQueryOne.mockRejectedValueOnce(err)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/already exists/)
  })

  it('returns 500 when create_coupon insert throws generic error', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('create_coupon', {
        code: 'X',
        discountType: 'flat',
        discountValue: 100,
        validUntil: null,
        minPurchaseAmount: null,
        usageLimit: null,
        description: null,
      }) as any
    )
    mockQueryOne.mockRejectedValueOnce(new Error('db down'))
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/db down/)
  })

  // ── update_campaign_template ───────────────────────────────────────────

  it('returns 500 when update_campaign_template missing kind', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('update_campaign_template', { campaignKind: '', newSubject: 'S', newBody: 'B' }) as any
    )
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/campaignKind missing/)
  })

  it('returns 500 when update_campaign_template has no fields to update', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('update_campaign_template', { campaignKind: 'k', newSubject: null, newBody: null }) as any
    )
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/No fields to update/)
  })

  it('executes update_campaign_template with only subject', async () => {
    mockQueryOne
      .mockResolvedValueOnce(
        proposed('update_campaign_template', { campaignKind: 'k', newSubject: 'S', newBody: null }) as any
      )
      .mockResolvedValueOnce({ kind: 'k', name: 'K' } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.subjectChanged).toBe(true)
    expect(body.result.bodyChanged).toBe(false)
  })

  it('returns 500 when update_campaign_template campaign missing', async () => {
    mockQueryOne
      .mockResolvedValueOnce(
        proposed('update_campaign_template', { campaignKind: 'x', newSubject: 'S', newBody: null }) as any
      )
      .mockResolvedValueOnce(null)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Campaign not found/)
  })

  // ── send_mailer_broadcast ──────────────────────────────────────────────

  it('returns 500 when send_mailer_broadcast missing subject/body', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('send_mailer_broadcast', {
        audience: 'test_only',
        testEmail: 'x@y.com',
        subject: '',
        body: 'b',
        fromName: 'S',
      }) as any
    )
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/subject and body required/)
  })

  it('returns 500 when send_mailer_broadcast test_only missing testEmail', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('send_mailer_broadcast', {
        audience: 'test_only',
        testEmail: null,
        subject: 'Hi',
        body: 'b',
        fromName: 'S',
      }) as any
    )
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/testEmail missing/)
  })

  it('reports all-failed when mailer_broadcast sendMail rejects for every recipient', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('send_mailer_broadcast', {
        audience: 'test_only',
        testEmail: 'x@y.com',
        subject: 'Hi',
        body: '<p>Hello</p>',
        fromName: 'S',
      }) as any
    )
    vi.mocked(transporter.sendMail).mockRejectedValue(new Error('SMTP boom'))
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/All 1 sends failed/)
  })

  // ── generate_personalized_coupon ───────────────────────────────────────

  it('returns 500 when generate_personalized_coupon missing fields', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('generate_personalized_coupon', { userId: '', discountType: 'flat', discountValue: 100 }) as any
    )
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Missing required fields/)
  })

  it('executes generate_personalized_coupon successfully', async () => {
    mockQueryOne
      .mockResolvedValueOnce(
        proposed('generate_personalized_coupon', {
          userId: 'u1',
          customerEmail: 'c@x.com',
          discountType: 'flat',
          discountValue: 100,
          daysValid: 7,
          campaign: 'BIRTHDAY',
          validUntil: '2099-01-01',
        }) as any
      )
      .mockResolvedValueOnce({ id: 'coupon-1', code: 'BIRTHDAY-ABC123' } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.code).toMatch(/^BIRTHDAY-/)
  })

  it('returns 500 on generate_personalized_coupon unique violation', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('generate_personalized_coupon', {
        userId: 'u1',
        customerEmail: 'c@x.com',
        discountType: 'flat',
        discountValue: 100,
        daysValid: 7,
        campaign: 'BIRTHDAY',
        validUntil: '2099-01-01',
      }) as any
    )
    const err: any = new Error('unique')
    err.code = '23505'
    mockQueryOne.mockRejectedValueOnce(err)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/collision/)
  })

  // ── create_product ─────────────────────────────────────────────────────

  it('returns 500 when create_product duplicate SKU', async () => {
    mockQueryOne
      .mockResolvedValueOnce(
        proposed('create_product', {
          name: 'Bolt',
          sku: 'DUP',
          slug: 'bolt',
          basePrice: 100,
          brandId: null,
          categoryId: null,
          shortDescription: null,
          weightGrams: 50,
          gstPercentage: 18,
        }) as any
      )
      .mockResolvedValueOnce({ id: 'existing' } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/already exists/)
  })

  it('returns 500 when create_product insert returns null', async () => {
    mockQueryOne
      .mockResolvedValueOnce(
        proposed('create_product', {
          name: 'Bolt',
          sku: 'NEW',
          slug: 'bolt',
          basePrice: 100,
          brandId: null,
          categoryId: null,
          shortDescription: null,
          weightGrams: 50,
          gstPercentage: 18,
        }) as any
      )
      .mockResolvedValueOnce(null) // dup check
      .mockResolvedValueOnce(null) // insert fails
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Insert failed/)
  })

  // ── update_product ─────────────────────────────────────────────────────

  it('executes update_product with allowed fields', async () => {
    mockQueryOne
      .mockResolvedValueOnce(
        proposed('update_product', {
          productId: 'p1',
          changes: { name: 'New', base_price: 200, is_featured: true, brand_id: '', unknown: 'skip' },
        }) as any
      )
      .mockResolvedValueOnce({ id: 'p1', name: 'New', is_active: true, is_featured: true } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    expect((await res.json()).result.is_featured).toBe(true)
  })

  it('returns 500 when update_product target not found', async () => {
    mockQueryOne
      .mockResolvedValueOnce(proposed('update_product', { productId: 'p1', changes: { name: 'X' } }) as any)
      .mockResolvedValueOnce(null)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Product not found')
  })

  // ── adjust_inventory ──────────────────────────────────────────────────

  it('returns 500 when adjust_inventory delta is non-integer', async () => {
    mockQueryOne.mockResolvedValueOnce(
      proposed('adjust_inventory', { productId: 'p1', delta: 1.5, reason: 'x' }) as any
    )
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Invalid delta/)
  })

  it('returns 500 when adjust_inventory delta is zero', async () => {
    mockQueryOne.mockResolvedValueOnce(proposed('adjust_inventory', { productId: 'p1', delta: 0, reason: 'x' }) as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Invalid delta/)
  })

  it('returns 500 when adjust_inventory product not found', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }), // SELECT
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValueOnce(client as any)
    mockQueryOne.mockResolvedValueOnce(
      proposed('adjust_inventory', { productId: 'p1', delta: 5, reason: 'restock' }) as any
    )
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Product not found')
  })

  it('returns 500 when adjust_inventory would push stock negative', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ inventory_quantity: 2 }] }),
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValueOnce(client as any)
    mockQueryOne.mockResolvedValueOnce(proposed('adjust_inventory', { productId: 'p1', delta: -5, reason: 'x' }) as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/drop stock to -3/)
  })

  it('executes adjust_inventory successfully', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ inventory_quantity: 10 }] }) // SELECT
        .mockResolvedValueOnce({}) // UPDATE
        .mockResolvedValueOnce({}), // COMMIT
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValueOnce(client as any)
    mockQueryOne.mockResolvedValueOnce(
      proposed('adjust_inventory', { productId: 'p1', delta: 5, reason: 'restock' }) as any
    )
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.current).toBe(15)
    expect(client.release).toHaveBeenCalled()
  })

  // ── set_product_featured ──────────────────────────────────────────────

  it('returns 500 when set_product_featured hits limit', async () => {
    mockQueryOne
      .mockResolvedValueOnce(proposed('set_product_featured', { productId: 'p1', featured: true, limit: 6 }) as any)
      .mockResolvedValueOnce({ n: 6 } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Featured limit \(6\) reached/)
  })

  it('executes set_product_featured (unfeature) successfully', async () => {
    mockQueryOne
      .mockResolvedValueOnce(proposed('set_product_featured', { productId: 'p1', featured: false, limit: 6 }) as any)
      .mockResolvedValueOnce({ id: 'p1', name: 'X', is_featured: false } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    expect((await res.json()).result.is_featured).toBe(false)
  })

  // ── create_brand ──────────────────────────────────────────────────────

  it('returns 500 when create_brand slug duplicate', async () => {
    mockQueryOne
      .mockResolvedValueOnce(proposed('create_brand', { name: 'B', slug: 'b', logoUrl: null }) as any)
      .mockResolvedValueOnce({ id: 'existing' } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/already exists/)
  })

  it('executes create_brand successfully', async () => {
    mockQueryOne
      .mockResolvedValueOnce(proposed('create_brand', { name: 'B', slug: 'b', logoUrl: null }) as any)
      .mockResolvedValueOnce(null) // dup check
      .mockResolvedValueOnce({ id: 'brand-1', name: 'B', slug: 'b', logo_url: null, is_active: true } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    expect((await res.json()).result.slug).toBe('b')
  })

  // ── create_category ───────────────────────────────────────────────────

  it('returns 500 when create_category missing name/slug', async () => {
    mockQueryOne.mockResolvedValueOnce(proposed('create_category', { name: '', slug: '', parentId: null }) as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/name and slug required/)
  })

  it('returns 500 when create_category parent missing', async () => {
    mockQueryOne
      .mockResolvedValueOnce(proposed('create_category', { name: 'C', slug: 'c', parentId: 'ghost' }) as any)
      .mockResolvedValueOnce(null) // parent lookup fails
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Parent category not found/)
  })

  it('returns 500 when create_category slug duplicate', async () => {
    mockQueryOne
      .mockResolvedValueOnce(proposed('create_category', { name: 'C', slug: 'c', parentId: null }) as any)
      .mockResolvedValueOnce({ id: 'existing' } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/already exists/)
  })

  it('executes create_category successfully', async () => {
    mockQueryOne
      .mockResolvedValueOnce(proposed('create_category', { name: 'C', slug: 'c', parentId: null }) as any)
      .mockResolvedValueOnce(null) // dup
      .mockResolvedValueOnce({ id: 'cat-1', name: 'C', slug: 'c', parent_id: null, is_active: true } as any)
    const res = await POST(makeReq(), params())
    expect(res.status).toBe(200)
    expect((await res.json()).result.slug).toBe('c')
  })
})
