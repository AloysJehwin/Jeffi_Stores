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
import { sendTestCampaignEmail } from '@/lib/automation-emails'
import { sendOrderDelayNotification, sendProductAnnouncementEmail, sendQuotationFinalizedEmail, transporter } from '@/lib/email'
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

describe('POST /api/admin/agent/actions/[id]/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rowCount: 1 } as any)
  })

  // ── add_customer_tag / remove_customer_tag ──────────────────────────────

  it('returns 500 when add_customer_tag missing fields', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'add_customer_tag', payload: { customerId: '', tagSlug: '' }, status: 'proposed',
    } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/customerId and tagSlug required/)
  })

  it('executes add_customer_tag successfully', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'add_customer_tag', payload: { customerId: 'c1', tagSlug: 'VIP' }, status: 'proposed',
    } as any)
    vi.mocked(query).mockResolvedValue({ rowCount: 1 } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect((await res.json()).result.tag).toBe('vip')
  })

  it('executes remove_customer_tag successfully', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'remove_customer_tag', payload: { customerId: 'c1', tagSlug: 'VIP' }, status: 'proposed',
    } as any)
    vi.mocked(query).mockResolvedValue({ rowCount: 1 } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect((await res.json()).result.removed).toBe(1)
  })

  it('returns 500 when remove_customer_tag missing fields', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'remove_customer_tag', payload: { customerId: '', tagSlug: '' }, status: 'proposed',
    } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/customerId and tagSlug required/)
  })

  // ── create_customer_task ────────────────────────────────────────────────

  it('returns 500 when create_customer_task missing fields', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'create_customer_task',
      payload: { customerId: '', title: '', dueAt: null, assignedToAdminId: null, priority: 'medium' },
      status: 'proposed',
    } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/customerId and title required/)
  })

  it('executes create_customer_task with invalid priority (defaults to medium)', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
        kind: 'create_customer_task',
        payload: { customerId: 'c1', title: 'Follow up', dueAt: null, assignedToAdminId: null, priority: 'invalid' },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce({ id: 'task-1' } as any)
    vi.mocked(query).mockResolvedValue({ rowCount: 1 } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect((await res.json()).result.priority).toBe('medium')
  })

  it('executes create_customer_task with valid urgent priority', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
        kind: 'create_customer_task',
        payload: { customerId: 'c1', title: 'Urgent', dueAt: '2026-09-01', assignedToAdminId: 'adm-2', priority: 'urgent' },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce({ id: 'task-2' } as any)
    vi.mocked(query).mockResolvedValue({ rowCount: 1 } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect((await res.json()).result.priority).toBe('urgent')
  })

  // ── close_customer_task ─────────────────────────────────────────────────

  it('returns 500 when close_customer_task task not found', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
        kind: 'close_customer_task', payload: { taskId: 'bad', resolution: null }, status: 'proposed',
      } as any)
      .mockResolvedValueOnce(null)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Task not found/)
  })

  it('returns 500 when task is already completed', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
        kind: 'close_customer_task', payload: { taskId: 'done', resolution: null }, status: 'proposed',
      } as any)
      .mockResolvedValueOnce({ id: 'done', user_id: 'c1', title: 'T', status: 'completed', description: null } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/already completed/)
  })

  it('executes close_customer_task with resolution', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
        kind: 'close_customer_task', payload: { taskId: 'open', resolution: 'Done.' }, status: 'proposed',
      } as any)
      .mockResolvedValueOnce({ id: 'open', user_id: 'c1', title: 'Follow up', status: 'open', description: null } as any)
    vi.mocked(query).mockResolvedValue({ rowCount: 1 } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect((await res.json()).result.taskId).toBe('open')
  })

  // ── update_campaign_template ────────────────────────────────────────────

  it('returns 500 when update_campaign_template campaignKind missing', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'update_campaign_template',
      payload: { campaignKind: '', newSubject: 'Hi', newBody: null }, status: 'proposed',
    } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/campaignKind missing/)
  })

  it('returns 500 when update_campaign_template nothing to update', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'update_campaign_template',
      payload: { campaignKind: 'welcome', newSubject: null, newBody: null }, status: 'proposed',
    } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/No fields to update/)
  })

  it('executes update_campaign_template successfully', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
        kind: 'update_campaign_template',
        payload: { campaignKind: 'welcome', newSubject: 'New Subject', newBody: null }, status: 'proposed',
      } as any)
      .mockResolvedValueOnce({ kind: 'welcome', name: 'Welcome' } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect((await res.json()).result.subjectChanged).toBe(true)
  })

  // ── generate_personalized_coupon ────────────────────────────────────────

  it('returns 500 when generate_personalized_coupon missing required fields', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'generate_personalized_coupon',
      payload: { userId: '', discountType: 'percentage', discountValue: 0, daysValid: 7, campaign: 'X', validUntil: '2026-12-31' },
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
        payload: { userId: 'u1', customerEmail: 'c@x.com', discountType: 'percentage', discountValue: 10, daysValid: 7, campaign: 'WELCOME', validUntil: '2026-12-31' },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce({ id: 'cp-1', code: 'WELCOME-ABCXYZ' } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect((await res.json()).result.code).toMatch(/^WELCOME-/)
  })

  // ── product announcement audiences ─────────────────────────────────────

  it('executes send_product_announcement_email for all_opted_in', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'send_product_announcement_email',
      payload: { productIds: ['p1'], audience: 'all_opted_in', testEmail: null, subject: 'New!', intro: 'Hi' },
      status: 'proposed',
    } as any)
    mockQueryMany
      .mockResolvedValueOnce([{ id: 'p1', name: 'Bolt', slug: 'bolt', price: '100', short_description: null, primary_image_url: null }] as any)
      .mockResolvedValueOnce([{ email: 'u@x.com', name: 'User' }, { email: 'v@x.com', name: 'User2' }] as any)
    vi.mocked(sendProductAnnouncementEmail).mockResolvedValue({ success: true } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect((await res.json()).result.sent).toBe(2)
  })

  it('executes send_product_announcement_email for recent_buyers', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'send_product_announcement_email',
      payload: { productIds: ['p1'], audience: 'recent_buyers', testEmail: null, subject: 'S', intro: 'I' },
      status: 'proposed',
    } as any)
    mockQueryMany
      .mockResolvedValueOnce([{ id: 'p1', name: 'Bolt', slug: 'bolt', price: '100', short_description: null, primary_image_url: null }] as any)
      .mockResolvedValueOnce([{ email: 'r@x.com', name: 'Buyer' }] as any)
    vi.mocked(sendProductAnnouncementEmail).mockResolvedValue({ success: true } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect((await res.json()).result.sent).toBe(1)
  })

  it('returns 500 when no active products resolved', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'send_product_announcement_email',
      payload: { productIds: ['bad'], audience: 'test_only', testEmail: 'x@y.com', subject: 'S', intro: 'I' },
      status: 'proposed',
    } as any)
    mockQueryMany.mockResolvedValueOnce([])
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/No active products resolved/)
  })

  it('returns 500 when all announcement sends fail', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'send_product_announcement_email',
      payload: { productIds: ['p1'], audience: 'test_only', testEmail: 'x@y.com', subject: 'S', intro: 'I' },
      status: 'proposed',
    } as any)
    mockQueryMany.mockResolvedValueOnce([{ id: 'p1', name: 'Bolt', slug: 'bolt', price: '100', short_description: null, primary_image_url: null }] as any)
    vi.mocked(sendProductAnnouncementEmail).mockResolvedValue({ success: false } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/sends failed/)
  })

  // ── send_mailer_broadcast audiences ────────────────────────────────────

  it('executes send_mailer_broadcast for all_opted_in', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'send_mailer_broadcast',
      payload: { audience: 'all_opted_in', testEmail: null, subject: 'News', body: '<p>Hi</p>', fromName: 'Store' },
      status: 'proposed',
    } as any)
    mockQueryMany.mockResolvedValueOnce([{ email: 'u@x.com', name: 'User' }] as any)
    vi.mocked(transporter.sendMail).mockResolvedValue({} as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect((await res.json()).result.sent).toBe(1)
  })

  it('executes send_mailer_broadcast for recent_buyers', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'send_mailer_broadcast',
      payload: { audience: 'recent_buyers', testEmail: null, subject: 'Sale', body: '<p>Hi</p>', fromName: 'Store' },
      status: 'proposed',
    } as any)
    mockQueryMany.mockResolvedValueOnce([{ email: 'b@x.com', name: 'Buyer' }] as any)
    vi.mocked(transporter.sendMail).mockResolvedValue({} as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect((await res.json()).result.sent).toBe(1)
  })

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

  it('returns 500 when send_mailer_broadcast testEmail missing for test_only', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'send_mailer_broadcast',
      payload: { audience: 'test_only', testEmail: null, subject: 'Hi', body: '<p>Hi</p>', fromName: 'Store' },
      status: 'proposed',
    } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/testEmail missing/)
  })

  // ── update_product valid field + not found ──────────────────────────────

  it('executes update_product with valid field', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
        kind: 'update_product', payload: { productId: 'p1', changes: { name: 'Updated', is_active: true } }, status: 'proposed',
      } as any)
      .mockResolvedValueOnce({ id: 'p1', name: 'Updated', is_active: true, is_featured: false } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect((await res.json()).result.name).toBe('Updated')
  })

  it('returns 500 when update_product product not found', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
        kind: 'update_product', payload: { productId: 'missing', changes: { name: 'X' } }, status: 'proposed',
      } as any)
      .mockResolvedValueOnce(null)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Product not found/)
  })

  // ── create_product duplicate SKU ────────────────────────────────────────

  it('returns 500 when create_product SKU already exists', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
        kind: 'create_product',
        payload: { name: 'Bolt', sku: 'DUP', slug: 'bolt', basePrice: 100, brandId: null, categoryId: null, shortDescription: null, weightGrams: 50, gstPercentage: 18 },
        status: 'proposed',
      } as any)
      .mockResolvedValueOnce({ id: 'existing' } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/already exists/)
  })

  // ── create_brand success + duplicate ────────────────────────────────────

  it('returns 500 when create_brand slug/name already exists', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
        kind: 'create_brand', payload: { name: 'Unbrako', slug: 'unbrako', logoUrl: null }, status: 'proposed',
      } as any)
      .mockResolvedValueOnce({ id: 'existing-brand' } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/already exists/)
  })

  it('executes create_brand successfully', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
        kind: 'create_brand', payload: { name: 'New Brand', slug: 'new-brand', logoUrl: null }, status: 'proposed',
      } as any)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'b1', name: 'New Brand', slug: 'new-brand', logo_url: null, is_active: true } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect((await res.json()).result.slug).toBe('new-brand')
  })

  // ── create_tag_definition ───────────────────────────────────────────────

  it('returns 500 when create_tag_definition slug missing', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
      kind: 'create_tag_definition', payload: { slug: '', color: 'blue' }, status: 'proposed',
    } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/slug required/)
  })

  it('executes create_tag_definition successfully', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
        kind: 'create_tag_definition', payload: { slug: 'premium', color: '#gold' }, status: 'proposed',
      } as any)
      .mockResolvedValueOnce({ sort_order: 10 } as any)
    vi.mocked(query).mockResolvedValue({ rowCount: 1 } as any)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(200)
    expect((await res.json()).result.slug).toBe('premium')
  })

  // ── mark_invoice_paid not found ─────────────────────────────────────────

  it('returns 500 when mark_invoice_paid invoice not found', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: ACTION_ID, admin_id: ADMIN.adminId, conversation_id: 'conv-1',
        kind: 'mark_invoice_paid', payload: { orderId: 'bad', paymentMode: 'upi', paidAt: null }, status: 'proposed',
      } as any)
      .mockResolvedValueOnce(null)
    const res = await POST(makeReq(), { params: Promise.resolve({ id: ACTION_ID }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/not found|already paid/)
  })
})
