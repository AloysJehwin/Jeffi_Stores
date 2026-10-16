import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/app/api/(admin)/admin/crm/overview/summary', () => ({ getCrmOverview: vi.fn() }))

import { GET } from '@/app/api/(admin)/admin/crm/overview/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getCrmOverview } from '@/app/api/(admin)/admin/crm/overview/summary'
import { istToday, presetPeriod } from '@/app/(admin)/admin/crm/_lib/period'

const mockScope = vi.mocked(requireAdminScope)
const mockOverview = vi.mocked(getCrmOverview)

const req = (qs = '') => new NextRequest(`http://localhost/api/admin/crm/overview${qs}`)

describe('GET /api/admin/crm/overview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockScope.mockResolvedValue({ adminId: 'a1', role: 'super_admin', scopes: [] } as any)
    mockOverview.mockResolvedValue({ current: {} } as any)
  })

  it('requires crm:read', async () => {
    mockScope.mockResolvedValue(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    const res = await GET(req())
    expect(res.status).toBe(403)
    expect(mockScope).toHaveBeenCalledWith(expect.anything(), 'crm:read')
    expect(mockOverview).not.toHaveBeenCalled()
  })

  it('passes a valid period through', async () => {
    const res = await GET(req('?from=2026-09-01&to=2026-09-30'))
    expect(res.status).toBe(200)
    expect(mockOverview).toHaveBeenCalledWith({ from: '2026-09-01', to: '2026-09-30' })
  })

  it('defaults to the last 30 days on bad input', async () => {
    await GET(req('?from=2026-13-01&to=x'))
    expect(mockOverview).toHaveBeenCalledWith(presetPeriod('30d', istToday()))
  })

  it('returns 500 when the query fails', async () => {
    mockOverview.mockRejectedValue(new Error('db down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await GET(req())
    expect(res.status).toBe(500)
  })
})
