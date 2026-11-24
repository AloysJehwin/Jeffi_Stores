import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/payments/rzp-account', () => ({ razorpayAccountFor: vi.fn() }))
vi.mock('@/lib/payments/rzp-route-report', () => ({ routeOverview: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/financial/route-payouts/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { razorpayAccountFor } from '@/lib/payments/rzp-account'
import { routeOverview } from '@/lib/payments/rzp-route-report'

const req = (qs = '?from=2026-10-01&to=2026-10-31&tenantId=other') => new NextRequest(`http://localhost/api/admin/financial/route-payouts${qs}`)

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
  vi.mocked(razorpayAccountFor).mockResolvedValue({ kind: 'route', tenantId: 't1' } as any)
})

describe('GET /api/admin/financial/route-payouts', () => {
  it.each([[401], [403]])('passes through the %i from requireAdminScope', async (status) => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'no' }, { status }) as any)
    expect((await GET(req())).status).toBe(status)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'financial:read')
  })

  it.each([[{ kind: 'own', tenantId: 't1' }], [{ kind: 'platform' }], [{ kind: 'route', tenantId: null }]])('returns 404 when the store is not a Route store (%j)', async (account) => {
    vi.mocked(razorpayAccountFor).mockResolvedValue(account as any)
    expect((await GET(req())).status).toBe(404)
    expect(routeOverview).not.toHaveBeenCalled()
  })

  it.each([[''], ['?from=2026-10-31&to=2026-10-01'], ['?from=2024-01-01&to=2026-01-01']])('returns 400 for invalid period %s', async (qs) => {
    expect((await GET(req(qs))).status).toBe(400)
    expect(routeOverview).not.toHaveBeenCalled()
  })

  it('uses the store from the host, never the query', async () => {
    vi.mocked(routeOverview).mockResolvedValue({ sales: 1000, payouts: [] } as any)
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sales: 1000, payouts: [] })
    expect(routeOverview).toHaveBeenCalledWith('t1', '2026-10-01', '2026-10-31')
  })

  it('lets a report failure propagate', async () => {
    vi.mocked(routeOverview).mockRejectedValue(new Error('boom'))
    await expect(GET(req())).rejects.toThrow('boom')
  })
})
