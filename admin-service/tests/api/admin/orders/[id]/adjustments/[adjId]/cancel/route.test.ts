import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))
vi.mock('@/lib/replies/context', () => ({ closeReplyContexts: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/orders/[id]/adjustments/[adjId]/cancel/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'
import { closeReplyContexts } from '@/lib/replies/context'

const admin = { adminId: 'a1', username: 'admin', role: 'admin', scopes: [] }
const call = () =>
  POST(new NextRequest('http://localhost/x', { method: 'POST' }), {
    params: Promise.resolve({ id: 'o1', adjId: 'adj1' }),
  })

describe('POST /api/admin/orders/[id]/adjustments/[adjId]/cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
    vi.mocked(hasScope).mockReturnValue(true)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null)
    expect((await call()).status).toBe(401)
  })

  it('returns 403 without orders:write', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await call()).status).toBe(403)
    expect(queryOne).not.toHaveBeenCalled()
  })

  it('returns 409 when the adjustment can no longer be cancelled', async () => {
    vi.mocked(queryOne).mockResolvedValue(null)
    const res = await call()
    expect(res.status).toBe(409)
    expect(closeReplyContexts).not.toHaveBeenCalled()
  })

  it('cancels the adjustment and closes its reply contexts', async () => {
    vi.mocked(queryOne).mockResolvedValue({ id: 'adj1' })
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    const [sql, params] = vi.mocked(queryOne).mock.calls[0]
    expect(sql).toMatch(/status = 'cancelled'/)
    expect(sql).toMatch(/razorpay_payment_id IS NULL/)
    expect(params).toEqual(['adj1', 'o1'])
    expect(closeReplyContexts).toHaveBeenCalledWith('orders', 'o1', 'order_adjustment')
  })

  it('propagates a database failure', async () => {
    vi.mocked(queryOne).mockRejectedValue(new Error('db'))
    await expect(call()).rejects.toThrow('db')
  })
})
