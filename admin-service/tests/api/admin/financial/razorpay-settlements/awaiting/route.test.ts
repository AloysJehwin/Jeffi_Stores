import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/payments/rzp-account', () => ({ razorpayAccountFor: vi.fn() }))
vi.mock('@/lib/payments/rzp-settlement-report', () => ({ awaitingSettlement: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/financial/razorpay-settlements/awaiting/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { razorpayAccountFor } from '@/lib/payments/rzp-account'
import { awaitingSettlement } from '@/lib/payments/rzp-settlement-report'

const req = () => new NextRequest('http://localhost/api/admin/financial/razorpay-settlements/awaiting')

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(razorpayAccountFor).mockResolvedValue({ kind: 'platform' } as any)
})

describe('GET /api/admin/financial/razorpay-settlements/awaiting', () => {
  it.each([[401], [403]])('passes through the %i from requireAdminScope', async (status) => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'no' }, { status }) as any)
    expect((await GET(req())).status).toBe(status)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'financial:read')
  })

  it('returns 404 for a Route store', async () => {
    vi.mocked(razorpayAccountFor).mockResolvedValue({ kind: 'route' } as any)
    expect((await GET(req())).status).toBe(404)
    expect(awaitingSettlement).not.toHaveBeenCalled()
  })

  it('returns payments awaiting settlement for the account kind', async () => {
    vi.mocked(awaitingSettlement).mockResolvedValue({ total: 5900, payments: [] } as any)
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ total: 5900, payments: [] })
    expect(awaitingSettlement).toHaveBeenCalledWith('platform')
  })

  it('lets a report failure propagate', async () => {
    vi.mocked(awaitingSettlement).mockRejectedValue(new Error('db down'))
    await expect(GET(req())).rejects.toThrow('db down')
  })
})
