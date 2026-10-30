import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/traffic/report', () => ({ trafficReport: vi.fn() }))

import { GET } from '@controller/app/api/(admin)/admin/traffic/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { trafficReport } from '@/lib/traffic/report'
import { trafficPeriod } from '@/lib/traffic/period'

const mockScope = vi.mocked(requireAdminScope)
const mockReport = vi.mocked(trafficReport)

const req = (qs = '', headers: Record<string, string> = {}) => new NextRequest(`http://localhost/api/admin/traffic${qs}`, { headers })

describe('GET /api/admin/traffic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockScope.mockResolvedValue({ adminId: 'a1', role: 'super_admin', scopes: [] } as any)
    mockReport.mockResolvedValue({ current: {} } as any)
  })

  it('requires traffic:read', async () => {
    mockScope.mockResolvedValue(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    const res = await GET(req())
    expect(res.status).toBe(403)
    expect(mockScope).toHaveBeenCalledWith(expect.anything(), 'traffic:read')
    expect(mockReport).not.toHaveBeenCalled()
  })

  it('loads only the requested tab for a valid period', async () => {
    const res = await GET(req('?tab=funnel&from=2026-09-01&to=2026-09-30', { 'x-forwarded-host': 'admin.jeffistores.in' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ tab: 'funnel', current: {} })
    expect(mockReport).toHaveBeenCalledTimes(1)
    expect(mockReport).toHaveBeenCalledWith('funnel', { from: '2026-09-01', to: '2026-09-30' }, { selfHosts: expect.arrayContaining(['jeffistores.in']) })
  })

  it('defaults to the overview and the last 30 days', async () => {
    await GET(req('?from=2026-13-01&to=x'))
    expect(mockReport).toHaveBeenCalledWith('overview', trafficPeriod(null, null), expect.anything())
  })

  it('rejects an unknown tab', async () => {
    const res = await GET(req('?tab=nope'))
    expect(res.status).toBe(400)
    expect(mockReport).not.toHaveBeenCalled()
  })

  it('returns 500 when a query fails', async () => {
    mockReport.mockRejectedValue(new Error('db down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await GET(req('?tab=search'))
    expect(res.status).toBe(500)
  })
})
