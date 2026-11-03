import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/overviews/subscriptions', () => ({ loadSubscriptionOverview: vi.fn() }))
vi.mock('@/lib/queries/subscriptions', () => ({ getAdminSubscriptionStats: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/subscriptions/overview/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { loadSubscriptionOverview } from '@/lib/overviews/subscriptions'
import { getAdminSubscriptionStats } from '@/lib/queries/subscriptions'

const headline = { active: 3, paused: 0, halted: 1, cancelled: 2, mrr: 900 }

const req = (qs = '') => new NextRequest(`http://localhost/api/admin/subscriptions/overview${qs}`)

describe('GET /api/admin/subscriptions/overview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: ['subscriptions:read'] } as any)
    vi.mocked(loadSubscriptionOverview).mockResolvedValue({ attention: [] } as any)
    vi.mocked(getAdminSubscriptionStats).mockResolvedValue(headline)
  })

  it('is gated on subscriptions:read', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    const res = await GET(req())
    expect(res.status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'subscriptions:read')
    expect(loadSubscriptionOverview).not.toHaveBeenCalled()
  })

  it('passes the requested period', async () => {
    const res = await GET(req('?from=2026-10-01&to=2026-10-10'))
    expect(res.status).toBe(200)
    expect(vi.mocked(loadSubscriptionOverview).mock.calls[0]).toEqual([{ from: '2026-10-01', to: '2026-10-10' }, headline])
  })

  it('falls back to 30 days on a bad range', async () => {
    await GET(req('?from=2026-10-10&to=2026-10-01'))
    const p = vi.mocked(loadSubscriptionOverview).mock.calls[0][0]
    expect(p.from < p.to).toBe(true)
  })

  it('returns 500 when the query fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(loadSubscriptionOverview).mockRejectedValue(new Error('boom'))
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect((await res.json()).error).not.toContain('boom')
  })
})
