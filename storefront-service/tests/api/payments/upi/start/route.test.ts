import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const authenticateAnyUser = vi.hoisted(() => vi.fn())
const handleUpiStart = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/jwt', () => ({ authenticateAnyUser }))
vi.mock('@/lib/payments/upi/handlers', () => ({ handleUpiStart }))

import { POST } from '@storefront/app/api/(public)/payments/upi/start/route'

const post = (headers: Record<string, string> = {}) =>
  POST(new NextRequest('http://localhost/api/payments/upi/start', { method: 'POST', headers }))

describe('POST /api/payments/upi/start', () => {
  beforeEach(() => {
    authenticateAnyUser.mockResolvedValue({ userId: 'u1' })
    handleUpiStart.mockResolvedValue(NextResponse.json({ intentId: 'i1' }))
  })

  it('401s when unauthenticated and starts nothing', async () => {
    authenticateAnyUser.mockResolvedValue(null)
    expect((await post()).status).toBe(401)
    expect(handleUpiStart).not.toHaveBeenCalled()
  })

  it('starts a customer payment with the storefront return prefix', async () => {
    const res = await post()
    expect(await res.json()).toEqual({ intentId: 'i1' })
    expect(handleUpiStart).toHaveBeenCalledWith(expect.anything(), { kind: 'customer', userId: 'u1', isBusiness: false }, { returnPrefix: '' })
  })

  it('uses the business return prefix for a business user or the business portal header', async () => {
    authenticateAnyUser.mockResolvedValue({ userId: 'b1', isBusiness: true })
    await post()
    expect(handleUpiStart).toHaveBeenLastCalledWith(expect.anything(), { kind: 'customer', userId: 'b1', isBusiness: true }, { returnPrefix: '/business' })
    authenticateAnyUser.mockResolvedValue({ userId: 'u2' })
    await post({ 'x-auth-portal': 'business' })
    expect(handleUpiStart).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ isBusiness: true }), { returnPrefix: '/business' })
  })

  it('passes a handler error response through', async () => {
    handleUpiStart.mockResolvedValue(NextResponse.json({ error: 'UPI unavailable' }, { status: 503 }))
    expect((await post()).status).toBe(503)
  })
})
