import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(), queryMany: vi.fn() }))

import { GET } from '@controller/app/api/(admin)/admin/coupons/overview/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryMany, queryOne } from '@/lib/shared/db'

const req = (qs = '') => new NextRequest(`http://localhost/api/admin/coupons/overview${qs}`)

describe('GET /api/admin/coupons/overview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: ['coupons:read'] } as any)
    vi.mocked(queryOne).mockResolvedValue({} as any)
    vi.mocked(queryMany).mockResolvedValue([])
  })

  it('is gated on coupons:read', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(
      NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    )
    expect((await GET(req())).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'coupons:read')
    expect(queryMany).not.toHaveBeenCalled()
  })

  it('returns the period, the previous period and the attention list', async () => {
    const res = await GET(req('?from=2026-10-01&to=2026-10-10'))
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.period).toEqual({ from: '2026-10-01', to: '2026-10-10' })
    expect(j.previous).toEqual({ from: '2026-09-21', to: '2026-09-30' })
    expect(Array.isArray(j.attention)).toBe(true)
    expect(j).toHaveProperty('series')
    expect(j).toHaveProperty('top')
    expect(j).toHaveProperty('sources')
    expect(j).toHaveProperty('state')
    expect(j).toHaveProperty('expiring')
    expect(j).toHaveProperty('unused')
    expect(j.bucket).toBe('day')
    expect(j.series).toEqual([])
    expect(vi.mocked(queryMany).mock.calls[0][1]).toEqual(['2026-09-21', '2026-10-01', '2026-10-10'])
  })

  it('falls back to the default period on a bad range', async () => {
    const j = await (await GET(req('?from=2026-10-10&to=2026-10-01'))).json()
    expect(j.period.from <= j.period.to).toBe(true)
  })

  it('returns 500 when a query fails', async () => {
    vi.mocked(queryMany).mockRejectedValue(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await GET(req())).status).toBe(500)
  })
})
