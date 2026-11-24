import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/marketplace/settlements', () => ({ loadMarketplaceSettlementsOverview: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/financial/marketplace-settlements/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { loadMarketplaceSettlementsOverview } from '@/lib/marketplace/settlements'

const ADMIN = { adminId: 'a1', role: 'admin', scopes: [] }
const req = (qs = '?from=2026-10-01&to=2026-10-31') => new NextRequest(`http://localhost/api/admin/financial/marketplace-settlements${qs}`)

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue(ADMIN as any)
})

describe('GET /api/admin/financial/marketplace-settlements', () => {
  it.each([[401], [403]])('passes through the %i from requireAdminScope', async (status) => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'no' }, { status }) as any)
    expect((await GET(req())).status).toBe(status)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'financial:read')
    expect(loadMarketplaceSettlementsOverview).not.toHaveBeenCalled()
  })

  it.each([[''], ['?from=2026-10-31&to=2026-10-01'], ['?from=2024-01-01&to=2026-01-01'], ['?from=bad&to=2026-10-01']])('returns 400 for invalid period %s', async (qs) => {
    expect((await GET(req(qs))).status).toBe(400)
    expect(loadMarketplaceSettlementsOverview).not.toHaveBeenCalled()
  })

  it('loads the overview for the period', async () => {
    vi.mocked(loadMarketplaceSettlementsOverview).mockResolvedValue({ myntra: [], total: 0 } as any)
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ myntra: [], total: 0 })
    expect(loadMarketplaceSettlementsOverview).toHaveBeenCalledWith({ from: '2026-10-01', to: '2026-10-31' })
  })

  it('returns 500 when loading fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(loadMarketplaceSettlementsOverview).mockRejectedValue(new Error('db'))
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Could not load marketplace settlements' })
  })
})
