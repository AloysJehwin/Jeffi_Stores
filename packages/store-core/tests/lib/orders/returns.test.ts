import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))
const db = vi.hoisted(() => {
  const client = { query: vi.fn() }
  return {
    client,
    queryOne: vi.fn(),
    queryMany: vi.fn(async () => []),
    withTransaction: vi.fn(async (fn: (c: any) => any) => fn(client)),
  }
})
vi.mock('@/lib/shared/db', () => ({ queryOne: db.queryOne, queryMany: db.queryMany, withTransaction: db.withTransaction }))
const email = vi.hoisted(() => ({ sendReturnStatusEmail: vi.fn(async () => {}) }))
vi.mock('@/lib/email', () => email)
const act = vi.hoisted(() => ({ logActivity: vi.fn(async () => {}) }))
vi.mock('@/lib/shared/activity', () => act)
const tasks = vi.hoisted(() => ({ createAutoTask: vi.fn(async () => {}) }))
vi.mock('@/lib/shared/auto-tasks', () => tasks)
const policy = vi.hoisted(() => ({ checkReturnEligibility: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/catalog/return-policy', () => policy)
const notify = vi.hoisted(() => ({ createAdminNotification: vi.fn(async () => {}) }))
vi.mock('@/lib/shared/admin-notify', () => notify)

import { createReturnRequest, RETURN_REASONS } from '@/lib/orders/returns'
import { queryOne, queryMany } from '@/lib/shared/db'
import { sendReturnStatusEmail } from '@/lib/email'
import { checkReturnEligibility } from '@/lib/catalog/return-policy'
import { logActivity } from '@/lib/shared/activity'
import { createAutoTask } from '@/lib/shared/auto-tasks'
import { createAdminNotification } from '@/lib/shared/admin-notify'

const input = (over: Record<string, any> = {}) => ({
  type: 'refund',
  reason: 'defective',
  description: 'broken',
  image_urls: ['u1'],
  items: [{ order_item_id: 'oi1', quantity: 2 }],
  ...over,
})

const deliveredOrder = (over: Record<string, any> = {}) => ({
  id: 'o1',
  status: 'delivered',
  order_number: 'ORD-1',
  delivered_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  user_id: 'u1',
  customer_name: 'Cara',
  customer_email: 'c@acme.test',
  first_name: 'Cara',
  last_name: 'Lee',
  user_email: 'cara@acme.test',
  ...over,
})

const orderItem = (over: Record<string, any> = {}) => ({
  id: 'oi1',
  product_id: 'p1',
  variant_id: 'v1',
  product_name: 'Widget',
  variant_name: 'Red',
  quantity: '3',
  unit_price: '100',
  is_digital: false,
  ...over,
})

beforeEach(() => {
  vi.mocked(checkReturnEligibility).mockResolvedValue({ ok: true } as any)
  delete process.env.MONTHLY_RETURN_LIMIT
  delete process.env.ADMIN_EMAIL
})

describe('createReturnRequest input validation', () => {
  it('rejects a bad type', async () => {
    expect(await createReturnRequest('u1', 'o1', input({ type: 'exchange' }))).toEqual({ ok: false, status: 400, error: 'Invalid type. Must be refund or replacement.' })
  })
  it('rejects a bad reason', async () => {
    expect(await createReturnRequest('u1', 'o1', input({ reason: 'bored' }))).toEqual({ ok: false, status: 400, error: 'Invalid reason.' })
  })
  it('rejects empty items', async () => {
    expect(await createReturnRequest('u1', 'o1', input({ items: [] }))).toEqual({ ok: false, status: 400, error: 'Please select at least one item to return.' })
  })
  it('exports the reasons list', () => {
    expect(RETURN_REASONS).toContain('defective')
  })
})

describe('createReturnRequest order checks', () => {
  it('404 when the order is not found', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null)
    expect(await createReturnRequest('u1', 'o1', input())).toEqual({ ok: false, status: 404, error: 'Order not found' })
  })
  it('400 when not delivered', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(deliveredOrder({ status: 'shipped' }))
    expect(await createReturnRequest('u1', 'o1', input())).toEqual({ ok: false, status: 400, error: 'Only delivered orders can be returned.' })
  })
  it('400 when a selected item does not belong to the order', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(deliveredOrder())
    vi.mocked(queryMany).mockResolvedValueOnce([]) // no matching items
    expect(await createReturnRequest('u1', 'o1', input())).toEqual({ ok: false, status: 400, error: 'One or more selected items do not belong to this order.' })
  })
  it('400 when a selected item is digital', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(deliveredOrder())
    vi.mocked(queryMany).mockResolvedValueOnce([orderItem({ is_digital: true })])
    expect(await createReturnRequest('u1', 'o1', input())).toEqual({ ok: false, status: 400, error: 'Digital items cannot be returned.' })
  })
  it('400 when eligibility fails', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(deliveredOrder())
    vi.mocked(queryMany).mockResolvedValueOnce([orderItem()])
    vi.mocked(checkReturnEligibility).mockResolvedValueOnce({ ok: false, reason: 'window closed' } as any)
    expect(await createReturnRequest('u1', 'o1', input())).toEqual({ ok: false, status: 400, error: 'window closed' })
  })
  it('400 when an open request already exists', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce(deliveredOrder()) // order
      .mockResolvedValueOnce({ id: 'existing' }) // existing open request
    vi.mocked(queryMany).mockResolvedValueOnce([orderItem()])
    expect(await createReturnRequest('u1', 'o1', input())).toEqual({ ok: false, status: 400, error: 'A return request already exists for this order.' })
  })
  it('400 when the monthly limit is reached', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce(deliveredOrder()) // order
      .mockResolvedValueOnce(null) // no existing
      .mockResolvedValueOnce({ cnt: '1' }) // monthly count
    vi.mocked(queryMany).mockResolvedValueOnce([orderItem()])
    const r = await createReturnRequest('u1', 'o1', input())
    expect(r).toEqual({ ok: false, status: 400, error: 'You have already used your return or replacement for this month. Only 1 is allowed per month.' })
  })
})

describe('createReturnRequest success', () => {
  it('inserts the request + items (qty capped), updates status, notifies admins', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce(deliveredOrder()) // order
      .mockResolvedValueOnce(null) // no existing
      .mockResolvedValueOnce({ cnt: '0' }) // monthly count
    vi.mocked(queryMany)
      .mockResolvedValueOnce([orderItem()]) // order items
      .mockResolvedValueOnce([{ email: 'admin@acme.test' }]) // admins
    db.client.query.mockResolvedValueOnce({ rows: [{ id: 'rr1' }] }) // insert return_requests

    const r = await createReturnRequest('u1', 'o1', input({ items: [{ order_item_id: 'oi1', quantity: 2 }] }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.returnRequest).toEqual({ id: 'rr1' })

    // item insert: qty 2 (<=3), refund = 2*100 = 200.00
    const itemInsert = db.client.query.mock.calls.find(c => String(c[0]).includes('INSERT INTO return_request_items'))
    expect(itemInsert![1]).toEqual(['rr1', 'oi1', 'p1', 'v1', 2, '100', 200, 'Widget', 'Red'])
    // status moves to return_requested
    expect(db.client.query.mock.calls.some(c => String(c[0]).includes("status = 'return_requested'"))).toBe(true)
    // admin email sent
    expect(sendReturnStatusEmail).toHaveBeenCalledWith(['admin@acme.test'], 'Cara Lee', 'ORD-1', 'o1', 'requested_admin', { returnType: 'refund', reason: 'defective' })
  })

  it('caps the return quantity at the ordered quantity', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce(deliveredOrder())
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ cnt: '0' })
    vi.mocked(queryMany)
      .mockResolvedValueOnce([orderItem({ quantity: '3' })])
      .mockResolvedValueOnce([])
    db.client.query.mockResolvedValueOnce({ rows: [{ id: 'rr1' }] })
    // request 10 but only 3 ordered -> capped at 3, refund 3*100 = 300
    await createReturnRequest('u1', 'o1', input({ items: [{ order_item_id: 'oi1', quantity: 10 }] }))
    const itemInsert = db.client.query.mock.calls.find(c => String(c[0]).includes('INSERT INTO return_request_items'))
    expect(itemInsert![1][4]).toBe(3)
    expect(itemInsert![1][6]).toBe(300)
  })

  it('appends the ADMIN_EMAIL fallback when no admins', async () => {
    process.env.ADMIN_EMAIL = 'fallback@acme.test'
    vi.mocked(queryOne)
      .mockResolvedValueOnce(deliveredOrder())
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ cnt: '0' })
    vi.mocked(queryMany)
      .mockResolvedValueOnce([orderItem()])
      .mockResolvedValueOnce([]) // no admins
    db.client.query.mockResolvedValueOnce({ rows: [{ id: 'rr1' }] })
    await createReturnRequest('u1', 'o1', input())
    expect(sendReturnStatusEmail).toHaveBeenCalledWith(['fallback@acme.test'], expect.anything(), 'ORD-1', 'o1', 'requested_admin', expect.anything())
  })

  it('respects a raised MONTHLY_RETURN_LIMIT', async () => {
    process.env.MONTHLY_RETURN_LIMIT = '3'
    vi.mocked(queryOne)
      .mockResolvedValueOnce(deliveredOrder())
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ cnt: '2' }) // 2 < 3, allowed
    vi.mocked(queryMany)
      .mockResolvedValueOnce([orderItem()])
      .mockResolvedValueOnce([])
    db.client.query.mockResolvedValueOnce({ rows: [{ id: 'rr1' }] })
    const r = await createReturnRequest('u1', 'o1', input())
    expect(r.ok).toBe(true)
  })
})

describe('createReturnRequest edge branches', () => {
  const setup = () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce(deliveredOrder({ first_name: '', last_name: '', user_email: null, delivered_at: null }))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ cnt: '0' })
    db.client.query.mockResolvedValueOnce({ rows: [{ id: 'rr1' }] })
  }

  it('falls back to ordered quantity, null image_urls, and customer_name/email when user fields are blank', async () => {
    setup()
    vi.mocked(queryMany)
      .mockResolvedValueOnce([orderItem({ quantity: '2', variant_id: null, variant_name: null })])
      .mockResolvedValueOnce([{ email: 'admin@acme.test' }])
    // no quantity on the item -> uses ordered qty 2; empty image_urls -> stored null
    await createReturnRequest('u1', 'o1', input({ image_urls: [], items: [{ order_item_id: 'oi1' }] }))
    const reqInsert = db.client.query.mock.calls.find(c => String(c[0]).includes('INSERT INTO return_requests'))
    expect(reqInsert![1][5]).toBeNull() // image_urls null
    const itemInsert = db.client.query.mock.calls.find(c => String(c[0]).includes('INSERT INTO return_request_items'))
    expect(itemInsert![1][4]).toBe(2) // qty fell back to ordered
    expect(itemInsert![1][3]).toBeNull() // variant_id null
    expect(itemInsert![1][8]).toBeNull() // variant_name null
    // name falls back to customer_name 'Cara'
    expect(sendReturnStatusEmail).toHaveBeenCalledWith(['admin@acme.test'], 'Cara', 'ORD-1', 'o1', 'requested_admin', expect.anything())
  })

  it('succeeds and swallows rejecting fire-and-forget side effects', async () => {
    setup()
    vi.mocked(queryMany)
      .mockResolvedValueOnce([orderItem()])
      .mockResolvedValueOnce([]) // no admins, and no ADMIN_EMAIL -> no email send
    vi.mocked(logActivity).mockRejectedValueOnce(new Error('log down'))
    vi.mocked(createAutoTask).mockRejectedValueOnce(new Error('task down'))
    vi.mocked(createAdminNotification).mockRejectedValueOnce(new Error('notify down'))
    const r = await createReturnRequest('u1', 'o1', { type: 'replacement', reason: 'damaged', description: null, image_urls: null, items: [{ order_item_id: 'oi1', quantity: 1 }] })
    expect(r.ok).toBe(true)
    expect(sendReturnStatusEmail).not.toHaveBeenCalled() // no admin recipients
  })
})
