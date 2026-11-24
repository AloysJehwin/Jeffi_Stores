import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/payments/rzp-account', () => ({ razorpayAccountFor: vi.fn() }))
vi.mock('@/lib/payments/rzp-settlement-report', () => ({ settlementDetail: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/financial/razorpay-settlements/[id]/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { razorpayAccountFor } from '@/lib/payments/rzp-account'
import { settlementDetail } from '@/lib/payments/rzp-settlement-report'

const req = () => new NextRequest('http://localhost/api/admin/financial/razorpay-settlements/setl_1')
const ctx = { params: Promise.resolve({ id: 'setl_1' }) }

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(razorpayAccountFor).mockResolvedValue({ kind: 'own' } as any)
})

describe('GET /api/admin/financial/razorpay-settlements/[id]', () => {
  it.each([[401], [403]])('passes through the %i from requireAdminScope', async (status) => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'no' }, { status }) as any)
    expect((await GET(req(), ctx)).status).toBe(status)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'financial:read')
    expect(settlementDetail).not.toHaveBeenCalled()
  })

  it('returns 404 for a Route store', async () => {
    vi.mocked(razorpayAccountFor).mockResolvedValue({ kind: 'route' } as any)
    expect((await GET(req(), ctx)).status).toBe(404)
    expect(settlementDetail).not.toHaveBeenCalled()
  })

  it('returns 404 when the settlement is unknown', async () => {
    vi.mocked(settlementDetail).mockResolvedValue(null as any)
    const res = await GET(req(), ctx)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Settlement not found' })
  })

  it('returns the settlement detail for the id', async () => {
    vi.mocked(settlementDetail).mockResolvedValue({ id: 'setl_1', amount: 1000 } as any)
    const res = await GET(req(), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'setl_1', amount: 1000 })
    expect(settlementDetail).toHaveBeenCalledWith('setl_1')
  })
})
