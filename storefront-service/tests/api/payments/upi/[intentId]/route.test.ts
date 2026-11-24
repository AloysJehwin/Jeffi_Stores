import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const authenticateAnyUser = vi.hoisted(() => vi.fn())
const handleUpiStatus = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/jwt', () => ({ authenticateAnyUser }))
vi.mock('@/lib/payments/upi/handlers', () => ({ handleUpiStatus }))

import { GET } from '@storefront/app/api/(public)/payments/upi/[intentId]/route'

const get = () =>
  GET(new NextRequest('http://localhost/api/payments/upi/i1'), { params: Promise.resolve({ intentId: 'i1' }) })

describe('GET /api/payments/upi/[intentId]', () => {
  beforeEach(() => {
    authenticateAnyUser.mockResolvedValue({ userId: 'u1' })
    handleUpiStatus.mockResolvedValue(NextResponse.json({ status: 'processing' }))
  })

  it('401s when unauthenticated', async () => {
    authenticateAnyUser.mockResolvedValue(null)
    expect((await get()).status).toBe(401)
    expect(handleUpiStatus).not.toHaveBeenCalled()
  })

  it('returns the intent status scoped to the caller', async () => {
    expect(await (await get()).json()).toEqual({ status: 'processing' })
    expect(handleUpiStatus).toHaveBeenCalledWith('i1', { kind: 'customer', userId: 'u1' })
  })

  it('passes a not-found response through', async () => {
    handleUpiStatus.mockResolvedValue(NextResponse.json({ error: 'Not found' }, { status: 404 }))
    expect((await get()).status).toBe(404)
  })
})
