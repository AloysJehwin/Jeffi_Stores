import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const authenticateAnyUser = vi.hoisted(() => vi.fn())
const handleUpiCheck = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/jwt', () => ({ authenticateAnyUser }))
vi.mock('@/lib/payments/upi/handlers', () => ({ handleUpiCheck }))

import { POST } from '@storefront/app/api/(public)/payments/upi/[intentId]/check/route'

const post = () =>
  POST(new NextRequest('http://localhost/api/payments/upi/i1/check', { method: 'POST' }), {
    params: Promise.resolve({ intentId: 'i1' }),
  })

describe('POST /api/payments/upi/[intentId]/check', () => {
  beforeEach(() => {
    authenticateAnyUser.mockResolvedValue({ userId: 'u1' })
    handleUpiCheck.mockResolvedValue(NextResponse.json({ status: 'paid' }))
  })

  it('401s when unauthenticated', async () => {
    authenticateAnyUser.mockResolvedValue(null)
    expect((await post()).status).toBe(401)
    expect(handleUpiCheck).not.toHaveBeenCalled()
  })

  it('checks the intent as the calling customer', async () => {
    expect(await (await post()).json()).toEqual({ status: 'paid' })
    expect(handleUpiCheck).toHaveBeenCalledWith('i1', { kind: 'customer', userId: 'u1' })
  })

  it('passes a gateway failure response through', async () => {
    handleUpiCheck.mockResolvedValue(NextResponse.json({ error: 'PhonePe unreachable' }, { status: 502 }))
    expect((await post()).status).toBe(502)
  })
})
