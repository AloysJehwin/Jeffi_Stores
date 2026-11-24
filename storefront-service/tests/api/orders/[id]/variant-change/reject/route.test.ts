import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const authenticateAnyUser = vi.hoisted(() => vi.fn())
const queryOne = vi.hoisted(() => vi.fn())
const query = vi.hoisted(() => vi.fn())
const logActivity = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/jwt', () => ({ authenticateAnyUser }))
vi.mock('@/lib/shared/db', () => ({ queryOne, query }))
vi.mock('@/lib/shared/activity', () => ({ logActivity }))

import { POST } from '@storefront/app/api/(public)/orders/[id]/variant-change/reject/route'

const post = () =>
  POST(new NextRequest('http://localhost/api/orders/o1/variant-change/reject', { method: 'POST' }), {
    params: Promise.resolve({ id: 'o1' }),
  })

describe('POST /api/orders/[id]/variant-change/reject', () => {
  beforeEach(() => {
    authenticateAnyUser.mockResolvedValue({ userId: 'u1' })
    queryOne.mockResolvedValue({ id: 'v1', status: 'pending_customer', user_id: 'u1', order_number: 'ORD-9' })
    query.mockResolvedValue({ rows: [] })
    logActivity.mockResolvedValue(undefined)
  })

  it('401s when unauthenticated', async () => {
    authenticateAnyUser.mockResolvedValue(null)
    expect((await post()).status).toBe(401)
    expect(query).not.toHaveBeenCalled()
  })

  it('404s when there is no pending request', async () => {
    queryOne.mockResolvedValue(null)
    expect((await post()).status).toBe(404)
  })

  it('403s when the order belongs to someone else and leaves the request untouched', async () => {
    queryOne.mockResolvedValue({ id: 'v1', status: 'pending_customer', user_id: 'other', order_number: 'ORD-9' })
    expect((await post()).status).toBe(403)
    expect(query).not.toHaveBeenCalled()
  })

  it('marks the request rejected and logs the activity', async () => {
    const res = await post()
    expect(await res.json()).toEqual({ success: true })
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status = 'rejected'"), ['v1'])
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', kind: 'variant_change', referenceId: 'o1', metadata: { vcrId: 'v1', rejected: true } })
    )
  })

  it('still rejects a guest-order request (no user to log for)', async () => {
    queryOne.mockResolvedValue({ id: 'v1', status: 'awaiting_payment', user_id: null, order_number: 'ORD-9' })
    expect((await post()).status).toBe(200)
    expect(logActivity).not.toHaveBeenCalled()
  })

  it('500s when the update fails', async () => {
    query.mockRejectedValue(new Error('db down'))
    const res = await post()
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('db down')
  })
})
