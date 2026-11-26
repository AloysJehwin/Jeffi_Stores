import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/queries', () => ({ getInsightsSeries: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/traffic/insights/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getInsightsSeries } from '@/lib/queries'

const req = (qs = '') => new NextRequest(`http://localhost/api/admin/traffic/insights${qs}`)

describe('GET /api/admin/traffic/insights', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
    vi.mocked(getInsightsSeries).mockResolvedValue({ weeks: 26, days: [] } as any)
  })

  it('has the traffic gate', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'no' }, { status: 403 }))
    expect((await GET(req())).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'traffic:read')
  })

  it('counts page views and distinct sessions over every page by default', async () => {
    expect((await GET(req())).status).toBe(200)
    const spec = vi.mocked(getInsightsSeries).mock.calls[0][0]
    expect(spec).toMatchObject({ table: 'page_events', weeks: 26, filter: 'all', params: [] })
    expect(spec.where).toBeUndefined()
    expect(spec.series?.map(s => s.value ?? 'COUNT(*)')).toEqual(['COUNT(*)', 'COUNT(DISTINCT e.session_id)'])
  })

  it('narrows to one kind of page through a bound parameter', async () => {
    await GET(req('?filter=checkout&weeks=52'))
    expect(vi.mocked(getInsightsSeries).mock.calls[0][0]).toMatchObject({ where: 'e.page = $1', params: ['checkout'], weeks: 52 })
  })

  it('rejects an unknown page or period and answers 500 on a failed query', async () => {
    expect((await GET(req('?filter=admin'))).status).toBe(400)
    expect((await GET(req('?weeks=4'))).status).toBe(400)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getInsightsSeries).mockRejectedValueOnce(new Error('db'))
    expect((await GET(req())).status).toBe(500)
  })
})
