import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateUser: vi.fn() }))
vi.mock('@/lib/loyalty/redeem', () => ({ redeemPoints: vi.fn() }))

import { POST } from '@controller/app/api/(public)/user/loyalty/redeem/route'
import { authenticateUser } from '@/lib/auth/jwt'
import { redeemPoints } from '@/lib/loyalty/redeem'

const mockAuth = authenticateUser as ReturnType<typeof vi.fn>
const mockRedeem = redeemPoints as ReturnType<typeof vi.fn>

function req(body: unknown) {
  return new NextRequest('http://localhost/api/user/loyalty/redeem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('POST /api/user/loyalty/redeem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ userId: 'u1', email: 'a@example.com' })
    mockRedeem.mockResolvedValue({ ok: true, code: 'RWD-ABCD2345', value: 200, points: 200, balance: 150 })
  })

  it('requires a signed-in customer', async () => {
    mockAuth.mockResolvedValue(null)
    expect((await POST(req({ points: 200 }))).status).toBe(401)
    expect(mockRedeem).not.toHaveBeenCalled()
  })

  it('rejects a body that is not a whole number of points', async () => {
    for (const body of [{}, { points: '200' }, { points: 1.5 }, { points: 0 }, 'not json']) {
      expect((await POST(req(body))).status).toBe(400)
    }
    expect(mockRedeem).not.toHaveBeenCalled()
  })

  it('redeems for the signed-in customer only', async () => {
    const res = await POST(req({ points: 200, userId: 'someone-else' }))
    expect(res.status).toBe(200)
    expect(mockRedeem).toHaveBeenCalledWith('u1', 200)
    expect(await res.json()).toEqual({ code: 'RWD-ABCD2345', value: 200, points: 200, balance: 150 })
  })

  it('explains each refusal with a fitting status', async () => {
    const cases = [
      { reason: 'disabled', status: 404, text: 'not available' },
      { reason: 'not_eligible', status: 403, text: 'not available for this account' },
      { reason: 'below_minimum', minimum: 100, status: 400, text: 'at least 100 points' },
      { reason: 'insufficient_points', status: 400, text: 'enough points' },
    ]
    for (const { status, text, ...failure } of cases) {
      mockRedeem.mockResolvedValue({ ok: false, ...failure })
      const res = await POST(req({ points: 200 }))
      const body = await res.json()
      expect(res.status).toBe(status)
      expect(body.error).toContain(text)
      expect(body.reason).toBe(failure.reason)
    }
  })

  it('answers 500 when redemption throws', async () => {
    mockRedeem.mockRejectedValue(new Error('db down'))
    expect((await POST(req({ points: 200 }))).status).toBe(500)
  })
})
