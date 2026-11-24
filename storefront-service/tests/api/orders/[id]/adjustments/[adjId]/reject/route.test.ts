import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const authenticateAnyUser = vi.hoisted(() => vi.fn())
const rejectAdjustment = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/jwt', () => ({ authenticateAnyUser }))
vi.mock('@/lib/orders/adjustment-decision', () => ({ rejectAdjustment }))

import { POST } from '@storefront/app/api/(public)/orders/[id]/adjustments/[adjId]/reject/route'

const post = () =>
  POST(new NextRequest('http://localhost/api/orders/o1/adjustments/a1/reject', { method: 'POST' }), {
    params: Promise.resolve({ id: 'o1', adjId: 'a1' }),
  })

describe('POST /api/orders/[id]/adjustments/[adjId]/reject', () => {
  beforeEach(() => {
    authenticateAnyUser.mockResolvedValue({ userId: 'u1' })
    rejectAdjustment.mockResolvedValue(true)
  })

  it('401s when unauthenticated', async () => {
    authenticateAnyUser.mockResolvedValue(null)
    expect((await post()).status).toBe(401)
    expect(rejectAdjustment).not.toHaveBeenCalled()
  })

  it('declines the adjustment for the caller', async () => {
    const res = await post()
    expect(await res.json()).toEqual({ success: true })
    expect(rejectAdjustment).toHaveBeenCalledWith('a1', 'o1', 'u1')
  })

  it('409s when the change can no longer be declined', async () => {
    rejectAdjustment.mockResolvedValue(false)
    expect((await post()).status).toBe(409)
  })
})
