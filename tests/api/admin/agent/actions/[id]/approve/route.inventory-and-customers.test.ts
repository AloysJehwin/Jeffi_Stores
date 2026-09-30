import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (must precede imports) ───────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryMany: vi.fn(),
  queryOne: vi.fn(),
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
vi.mock('@/lib/queries', () => ({ VARIANT_MIN_PRICE_SQL: '0' }))
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/inventory', () => ({ logStockMovement: vi.fn().mockResolvedValue(undefined) }))

// ── Imports ────────────────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/agent/actions/[id]/approve/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryMany, queryOne, withTransaction, getClient } from '@/lib/db'
import { sendTestCampaignEmail } from '@/lib/automation-emails'
import * as activity from '@/lib/activity'
import { sendAuditedMail } from '@/lib/mail-audit'
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

  // ── adjust_inventory ──────────────────────────────────────────────────────

  it('adjust_inventory invalid delta', async () => {
    mockQueryOne.mockResolvedValueOnce(action('adjust_inventory', { productId: 'p1', delta: 0, reason: 'x' }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/invalid delta/i)
  })

  it('adjust_inventory success', async () => {
    mockQueryOne.mockResolvedValueOnce(action('adjust_inventory', { productId: 'p1', delta: 5, reason: 'restock' }))
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [{ inventory_quantity: 10 }] }) // SELECT FOR UPDATE
        .mockResolvedValueOnce(undefined) // UPDATE
        .mockResolvedValue(undefined), // COMMIT
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
    expect(client.release).toHaveBeenCalled()
  })

  it('adjust_inventory product not found', async () => {
    mockQueryOne.mockResolvedValueOnce(action('adjust_inventory', { productId: 'p1', delta: 5, reason: 'x' }))
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SELECT → none
        .mockResolvedValue(undefined), // ROLLBACK
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/product not found/i)
  })

  it('adjust_inventory would drop stock negative', async () => {
    mockQueryOne.mockResolvedValueOnce(action('adjust_inventory', { productId: 'p1', delta: -20, reason: 'x' }))
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [{ inventory_quantity: 5 }] })
        .mockResolvedValue(undefined),
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/would drop stock/i)
  })

  it('adjust_inventory throws mid-transaction', async () => {
    mockQueryOne.mockResolvedValueOnce(action('adjust_inventory', { productId: 'p1', delta: 5, reason: 'x' }))
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockRejectedValueOnce(new Error('lock timeout')), // SELECT throws
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect(client.release).toHaveBeenCalled()
  })

  // ── set_product_featured ──────────────────────────────────────────────────

  it('set_product_featured under limit success', async () => {
    primeAction(
      action('set_product_featured', { productId: 'p1', featured: true, limit: 6 }),
      { n: 3 }, // count
      { id: 'p1', name: 'N', is_featured: true }
    )
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('set_product_featured limit reached', async () => {
    primeAction(action('set_product_featured', { productId: 'p1', featured: true, limit: 2 }), { n: 2 })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/limit .* reached/i)
  })

  it('set_product_featured unfeature not found', async () => {
    primeAction(action('set_product_featured', { productId: 'p1', featured: false, limit: 0 }), null) // update → not found
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  // ── create_brand ──────────────────────────────────────────────────────────

  it('create_brand missing name/slug', async () => {
    mockQueryOne.mockResolvedValueOnce(action('create_brand', { name: '', slug: '', logoUrl: null }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  it('create_brand duplicate', async () => {
    primeAction(action('create_brand', { name: 'Acme', slug: 'acme', logoUrl: null }), { id: 'b1' })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/already exists/i)
  })

  it('create_brand success', async () => {
    primeAction(action('create_brand', { name: 'Acme', slug: 'acme', logoUrl: 'l.png' }), null, {
      id: 'b1',
      name: 'Acme',
      slug: 'acme',
    })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('create_brand insert fails', async () => {
    primeAction(action('create_brand', { name: 'Acme', slug: 'acme', logoUrl: null }), null, null)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  // ── create_category ───────────────────────────────────────────────────────

  it('create_category missing name/slug', async () => {
    mockQueryOne.mockResolvedValueOnce(action('create_category', { name: '', slug: '', parentId: null }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  it('create_category parent not found', async () => {
    primeAction(action('create_category', { name: 'C', slug: 'c', parentId: 'par1' }), null)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/parent category not found/i)
  })

  it('create_category duplicate slug', async () => {
    primeAction(action('create_category', { name: 'C', slug: 'c', parentId: null }), { id: 'existing' })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/already exists/i)
  })

  it('create_category success with parent', async () => {
    primeAction(
      action('create_category', { name: 'C', slug: 'c', parentId: 'par1' }),
      { id: 'par1' }, // parent exists
      null, // dup check none
      { id: 'cat1', name: 'C', slug: 'c', parent_id: 'par1', is_active: true }
    )
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('create_category insert fails', async () => {
    primeAction(action('create_category', { name: 'C', slug: 'c', parentId: null }), null, null)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  // ── add_customer_note ─────────────────────────────────────────────────────

  it('add_customer_note missing fields', async () => {
    mockQueryOne.mockResolvedValueOnce(action('add_customer_note', { customerId: '', body: '' }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  it('add_customer_note too long', async () => {
    mockQueryOne.mockResolvedValueOnce(action('add_customer_note', { customerId: 'u1', body: 'x'.repeat(2001) }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/too long/i)
  })

  it('add_customer_note success (long note truncated in summary)', async () => {
    mockQueryOne.mockResolvedValueOnce(action('add_customer_note', { customerId: 'u1', body: 'y'.repeat(150) }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  // ── add_customer_tag / remove_customer_tag ────────────────────────────────

  it('add_customer_tag missing fields', async () => {
    mockQueryOne.mockResolvedValueOnce(action('add_customer_tag', { customerId: '', tagSlug: '' }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  it('add_customer_tag success', async () => {
    mockQueryOne.mockResolvedValueOnce(action('add_customer_tag', { customerId: 'u1', tagSlug: 'VIP' }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('remove_customer_tag missing fields', async () => {
    mockQueryOne.mockResolvedValueOnce(action('remove_customer_tag', { customerId: '', tagSlug: '' }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  it('remove_customer_tag success', async () => {
    mockQueryOne.mockResolvedValueOnce(action('remove_customer_tag', { customerId: 'u1', tagSlug: 'vip' }))
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  // ── create_customer_task / close_customer_task ────────────────────────────

  it('create_customer_task missing fields', async () => {
    mockQueryOne.mockResolvedValueOnce(action('create_customer_task', { customerId: '', title: '' }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  it('create_customer_task success (invalid priority → medium)', async () => {
    primeAction(
      action('create_customer_task', {
        customerId: 'u1',
        title: 'Call',
        dueAt: null,
        assignedToAdminId: null,
        priority: 'bogus',
      }),
      { id: 'task-1' }
    )
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('create_customer_task insert fails', async () => {
    primeAction(
      action('create_customer_task', {
        customerId: 'u1',
        title: 'Call',
        dueAt: '2026-01-01',
        assignedToAdminId: 'a2',
        priority: 'high',
      }),
      null
    )
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  it('close_customer_task missing taskId', async () => {
    mockQueryOne.mockResolvedValueOnce(action('close_customer_task', { taskId: '', resolution: null }))
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
  })

  it('close_customer_task not found', async () => {
    primeAction(action('close_customer_task', { taskId: 't1', resolution: 'done' }), null)
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/task not found/i)
  })

  it('close_customer_task already completed', async () => {
    primeAction(action('close_customer_task', { taskId: 't1', resolution: null }), {
      id: 't1',
      user_id: 'u1',
      title: 'T',
      status: 'completed',
      description: null,
    })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/already completed/i)
  })

  it('close_customer_task success with resolution (existing description)', async () => {
    primeAction(action('close_customer_task', { taskId: 't1', resolution: 'fixed it' }), {
      id: 't1',
      user_id: 'u1',
      title: 'T',
      status: 'open',
      description: 'prev',
    })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })

  it('close_customer_task success no resolution', async () => {
    primeAction(action('close_customer_task', { taskId: 't1', resolution: '' }), {
      id: 't1',
      user_id: 'u1',
      title: 'T',
      status: 'open',
      description: null,
    })
    const res = await POST(makeReq(), params)
    expect(res.status).toBe(200)
  })
})
