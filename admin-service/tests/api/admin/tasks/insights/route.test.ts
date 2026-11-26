import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { mondayGrid, summarize } from '@/lib/insights/series'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/queries', () => ({ getInsightsSeries: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/tasks/insights/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getInsightsSeries } from '@/lib/queries'

const req = (qs = '') => new NextRequest(`http://localhost/api/admin/tasks/insights${qs}`)
const grid = mondayGrid('2026-11-26', 13)
const part = (key: string, label: string, n: number) => {
  const days = grid.dates.map((date, i) => ({ date, values: [i === 90 ? n : 0] }))
  return { weeks: 13, filter: 'all', from: grid.from, to: grid.to, today: '2026-11-26', series: [{ key, label }], days, totals: summarize(days, '2026-11-26') }
}

describe('GET /api/admin/tasks/insights', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
    vi.mocked(getInsightsSeries).mockImplementation(async spec => (spec.dateColumn === 'created_at' ? part('created', 'Created', 5) : part('completed', 'Completed', 3)) as any)
  })

  it('has the tasks overview gate', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'no' }, { status: 403 }))
    expect((await GET(req())).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'customers:read')
  })

  it('merges created (by created_at) and completed (by completed_at) into one series', async () => {
    const res = await GET(req('?weeks=13'))
    expect(res.status).toBe(200)
    const { series } = await res.json()
    expect(series.series.map((s: any) => s.key)).toEqual(['created', 'completed'])
    expect(series.days[90].values).toEqual([5, 3])
    expect(series.totals.total).toBe(8)
    const specs = vi.mocked(getInsightsSeries).mock.calls.map(c => c[0])
    expect(specs.map(s => s.dateColumn).sort()).toEqual(['completed_at', 'created_at'])
    expect(specs.find(s => s.dateColumn === 'completed_at')?.where).toBe(`ct.status = 'completed'`)
  })

  it('narrows both queries to one priority through a bound parameter', async () => {
    await GET(req('?filter=urgent'))
    const specs = vi.mocked(getInsightsSeries).mock.calls.map(c => c[0])
    for (const s of specs) expect(s.params).toEqual(['urgent'])
    expect(specs.find(s => s.dateColumn === 'created_at')?.where).toBe('ct.priority = $1')
    expect(specs.find(s => s.dateColumn === 'completed_at')?.where).toBe(`ct.status = 'completed' AND ct.priority = $1`)
  })

  it('rejects an unknown priority and answers 500 on a failed query', async () => {
    expect((await GET(req('?filter=none'))).status).toBe(400)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getInsightsSeries).mockRejectedValue(new Error('db'))
    expect((await GET(req())).status).toBe(500)
  })
})
