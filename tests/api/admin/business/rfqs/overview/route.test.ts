import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(), queryMany: vi.fn() }))

import { GET } from '@/app/api/(admin)/admin/business/rfqs/overview/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryMany, queryOne } from '@/lib/shared/db'

const req = (qs = '') => new NextRequest(`http://localhost/api/admin/business/rfqs/overview${qs}`)

describe('GET /api/admin/business/rfqs/overview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({
      adminId: 'a1',
      role: 'manager',
      scopes: ['business_rfqs:read'],
    } as any)
    vi.mocked(queryOne).mockResolvedValue({} as any)
    vi.mocked(queryMany).mockResolvedValue([])
  })

  it('is gated on business_rfqs:read', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(
      NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    )
    const res = await GET(req())
    expect(res.status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'business_rfqs:read')
    expect(queryOne).not.toHaveBeenCalled()
    expect(queryMany).not.toHaveBeenCalled()
  })

  it('returns the period, the previous period, KPIs and attention', async () => {
    const j = await (await GET(req('?from=2026-10-01&to=2026-10-10'))).json()
    expect(j.range).toEqual({ from: '2026-10-01', to: '2026-10-10' })
    expect(j.previous_range).toEqual({ from: '2026-09-21', to: '2026-09-30' })
    expect(j.kpis.map((k: any) => k.key)).toContain('received')
    expect(Array.isArray(j.attention)).toBe(true)
  })

  it('falls back to 30 days on a bad range', async () => {
    const j = await (await GET(req('?from=2026-10-10&to=2026-10-01'))).json()
    expect(j.range.to > j.range.from).toBe(true)
  })

  it('returns 500 when the database fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(queryMany).mockRejectedValue(new Error('boom'))
    vi.mocked(queryOne).mockRejectedValue(new Error('boom'))
    expect((await GET(req())).status).toBe(500)
  })
})
