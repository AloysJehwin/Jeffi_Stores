import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const authenticateAnyUser = vi.hoisted(() => vi.fn())
const handleUpiCancel = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/jwt', () => ({ authenticateAnyUser }))
vi.mock('@/lib/payments/upi/handlers', () => ({ handleUpiCancel }))

import { POST } from '@storefront/app/api/(public)/payments/upi/[intentId]/cancel/route'

const post = () =>
  POST(new NextRequest('http://localhost/api/payments/upi/i1/cancel', { method: 'POST' }), {
    params: Promise.resolve({ intentId: 'i1' }),
  })

describe('POST /api/payments/upi/[intentId]/cancel', () => {
  beforeEach(() => {
    authenticateAnyUser.mockResolvedValue({ userId: 'u1' })
    handleUpiCancel.mockResolvedValue(NextResponse.json({ ok: true }))
  })

  it('401s when unauthenticated and cancels nothing', async () => {
    authenticateAnyUser.mockResolvedValue(null)
    expect((await post()).status).toBe(401)
    expect(handleUpiCancel).not.toHaveBeenCalled()
  })

  it('cancels the intent as the calling customer', async () => {
    expect(await (await post()).json()).toEqual({ ok: true })
    expect(handleUpiCancel).toHaveBeenCalledWith('i1', { kind: 'customer', userId: 'u1' })
  })

  it('passes a refusal through', async () => {
    handleUpiCancel.mockResolvedValue(NextResponse.json({ error: 'Already paid' }, { status: 409 }))
    expect((await post()).status).toBe(409)
  })
})
