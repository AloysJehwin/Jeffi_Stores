import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/queries', () => ({ getInsightsSeries: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/audit/insights/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getInsightsSeries } from '@/lib/queries'

const req = (qs = '') => new NextRequest(`http://localhost/api/admin/audit/insights${qs}`)

describe('GET /api/admin/audit/insights', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
    vi.mocked(getInsightsSeries).mockResolvedValue({ weeks: 26, days: [] } as any)
  })

  it('has the audit overview gate', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'no' }, { status: 403 }))
    expect((await GET(req())).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'audit:read')
  })

  it('splits events by team member and system, over every action by default', async () => {
    expect((await GET(req())).status).toBe(200)
    const spec = vi.mocked(getInsightsSeries).mock.calls[0][0]
    expect(spec).toMatchObject({ table: 'admin_audit_log', dateColumn: 'created_at', weeks: 26, filter: 'all', params: [] })
    expect(spec.where).toBeUndefined()
    expect(spec.series?.map(s => s.where)).toEqual(['l.admin_id IS NOT NULL', 'l.admin_id IS NULL'])
  })

  it('narrows to risky actions with the overview’s list, or to one verb through a bound parameter', async () => {
    await GET(req('?filter=risky'))
    expect(vi.mocked(getInsightsSeries).mock.calls[0][0].where).toBe(`l.action IN ('delete', 'import', 'export')`)
    await GET(req('?filter=update'))
    expect(vi.mocked(getInsightsSeries).mock.calls[1][0]).toMatchObject({ where: 'l.action = $1', params: ['update'] })
  })

  it('rejects an unknown filter and answers 500 on a failed query', async () => {
    expect((await GET(req('?filter=drop'))).status).toBe(400)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getInsightsSeries).mockRejectedValueOnce(new Error('db'))
    expect((await GET(req())).status).toBe(500)
  })
})
