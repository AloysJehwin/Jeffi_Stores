import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/payments/rzp-account', () => ({ razorpayAccountFor: vi.fn() }))
vi.mock('@/lib/payments/rzp-settlement-report', () => ({ settlementOverview: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/financial/razorpay-settlements/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { razorpayAccountFor } from '@/lib/payments/rzp-account'
import { settlementOverview } from '@/lib/payments/rzp-settlement-report'

const req = (qs = '?from=2026-10-01&to=2026-10-31') => new NextRequest(`http://localhost/api/admin/financial/razorpay-settlements${qs}`)

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(razorpayAccountFor).mockResolvedValue({ kind: 'own' } as any)
})

describe('GET /api/admin/financial/razorpay-settlements', () => {
  it.each([[401], [403]])('passes through the %i from requireAdminScope', async (status) => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'no' }, { status }) as any)
    expect((await GET(req())).status).toBe(status)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'financial:read')
    expect(settlementOverview).not.toHaveBeenCalled()
  })

  it('returns 404 for a Route store', async () => {
    vi.mocked(razorpayAccountFor).mockResolvedValue({ kind: 'route' } as any)
    expect((await GET(req())).status).toBe(404)
    expect(settlementOverview).not.toHaveBeenCalled()
  })

  it.each([[''], ['?from=2026-10-31&to=2026-10-01'], ['?from=2024-01-01&to=2026-01-01']])('returns 400 for invalid period %s', async (qs) => {
    expect((await GET(req(qs))).status).toBe(400)
    expect(settlementOverview).not.toHaveBeenCalled()
  })

  it('returns the overview for the account kind and period', async () => {
    vi.mocked(settlementOverview).mockResolvedValue({ settlements: [{ id: 'setl_1' }] } as any)
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ settlements: [{ id: 'setl_1' }] })
    expect(settlementOverview).toHaveBeenCalledWith('own', '2026-10-01', '2026-10-31')
  })

  it('lets a report failure propagate', async () => {
    vi.mocked(settlementOverview).mockRejectedValue(new Error('boom'))
    await expect(GET(req())).rejects.toThrow('boom')
  })
})
