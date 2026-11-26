import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { mondayGrid, summarize } from '@/lib/insights/series'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ isPlatformOwner: vi.fn() }))
vi.mock('@/lib/queries', () => ({ getInsightsSeries: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/team/insights/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { isPlatformOwner } from '@/lib/auth/scopes'
import { getInsightsSeries } from '@/lib/queries'

const req = (qs = '') => new NextRequest(`http://localhost/api/admin/team/insights${qs}`)
const grid = mondayGrid('2026-11-26', 13)
const part = (key: string, label: string, n: number) => {
  const days = grid.dates.map((date, i) => ({ date, values: [i === 90 ? n : 0] }))
  return { weeks: 13, filter: null, from: grid.from, to: grid.to, today: '2026-11-26', series: [{ key, label }], days, totals: summarize(days, '2026-11-26') }
}

describe('GET /api/admin/team/insights', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'owner', scopes: [] } as any)
    vi.mocked(isPlatformOwner).mockReturnValue(true)
    vi.mocked(getInsightsSeries).mockImplementation(async spec => (spec.table === 'auth_sessions' ? part('members', 'Members signed in', 2) : part('actions', 'Actions', 9)) as any)
  })

  it('is owner-only, like the team overview', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValueOnce(null)
    expect((await GET(req())).status).toBe(401)
    vi.mocked(isPlatformOwner).mockReturnValueOnce(false)
    expect((await GET(req())).status).toBe(403)
    expect(getInsightsSeries).not.toHaveBeenCalled()
  })

  it('merges members signed in (distinct, service accounts out) with admin actions', async () => {
    const res = await GET(req('?weeks=13'))
    expect(res.status).toBe(200)
    const { series } = await res.json()
    expect(series.series.map((s: any) => s.key)).toEqual(['members', 'actions'])
    expect(series.days[90].values).toEqual([2, 9])
    const specs = vi.mocked(getInsightsSeries).mock.calls.map(c => c[0])
    const sessions = specs.find(s => s.table === 'auth_sessions')
    expect(sessions?.series?.[0].value).toBe('COUNT(DISTINCT s.principal_id)')
    expect(sessions?.where).toContain(`IS DISTINCT FROM 'service_account'`)
    expect(specs.find(s => s.table === 'admin_audit_log')?.series?.[0].where).toBe('l.admin_id IS NOT NULL')
  })

  it('rejects an unknown period and answers 500 on a failed query', async () => {
    expect((await GET(req('?weeks=3'))).status).toBe(400)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getInsightsSeries).mockRejectedValue(new Error('db'))
    expect((await GET(req())).status).toBe(500)
  })
})
