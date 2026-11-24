import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const authenticateAnyUser = vi.hoisted(() => vi.fn())
const handleUpiConfirm = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/jwt', () => ({ authenticateAnyUser }))
vi.mock('@/lib/payments/upi/handlers', () => ({ handleUpiConfirm }))

import { POST } from '@storefront/app/api/(public)/payments/upi/[intentId]/confirm/route'

const post = () =>
  POST(
    new NextRequest('http://localhost/api/payments/upi/i1/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ utr: '123456789012' }),
    }),
    { params: Promise.resolve({ intentId: 'i1' }) }
  )

describe('POST /api/payments/upi/[intentId]/confirm', () => {
  beforeEach(() => {
    authenticateAnyUser.mockResolvedValue({ userId: 'u1' })
    handleUpiConfirm.mockResolvedValue(NextResponse.json({ status: 'confirmed' }))
  })

  it('401s when unauthenticated and confirms nothing', async () => {
    authenticateAnyUser.mockResolvedValue(null)
    expect((await post()).status).toBe(401)
    expect(handleUpiConfirm).not.toHaveBeenCalled()
  })

  it('forwards the request and intent to the confirm handler as the customer', async () => {
    expect(await (await post()).json()).toEqual({ status: 'confirmed' })
    const [req, intentId, actor] = handleUpiConfirm.mock.calls[0]
    expect(req).toBeInstanceOf(NextRequest)
    expect(intentId).toBe('i1')
    expect(actor).toEqual({ kind: 'customer', userId: 'u1' })
  })

  it('passes a bad-UTR rejection through', async () => {
    handleUpiConfirm.mockResolvedValue(NextResponse.json({ error: 'UTR not found' }, { status: 400 }))
    expect((await post()).status).toBe(400)
  })
})
