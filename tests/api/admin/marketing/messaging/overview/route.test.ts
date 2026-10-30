import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(), queryMany: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/marketing/messaging/overview/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryMany, queryOne } from '@/lib/shared/db'

const req = (qs = '') => new NextRequest(`http://localhost/api/admin/marketing/messaging/overview${qs}`)

describe('GET /api/admin/marketing/messaging/overview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: ['mailer:read'] } as any)
    vi.mocked(queryOne).mockResolvedValue({} as any)
    vi.mocked(queryMany).mockResolvedValue([])
  })

  it('is gated on mailer:read', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(
      NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    )
    expect((await GET(req())).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'mailer:read')
    expect(queryMany).not.toHaveBeenCalled()
  })

  it('returns the period, the previous period and the attention list', async () => {
    const res = await GET(req('?from=2026-10-01&to=2026-10-10'))
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.period).toEqual({ from: '2026-10-01', to: '2026-10-10' })
    expect(j.previous).toEqual({ from: '2026-09-21', to: '2026-09-30' })
    expect(Array.isArray(j.attention)).toBe(true)
    expect(j).toHaveProperty('channels')
    expect(j).toHaveProperty('failures')
    expect(j).toHaveProperty('broadcasts')
    expect(j).toHaveProperty('templates')
    expect(j).toHaveProperty('state')
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
