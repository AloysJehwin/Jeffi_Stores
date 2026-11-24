import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), getClient: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/integrations/resolve', () => ({ IntegrationNotConnectedError: class IntegrationNotConnectedError extends Error {} }))

vi.mock('@/lib/meta-ads/console', () => ({ MADS_TABS: ['overview', 'campaigns'], loadMadsTab: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/meta-ads/console/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { currentTenantPlanGate } from '@/lib/auth/plan-gate'
import { IntegrationNotConnectedError } from '@/lib/integrations/resolve'
import { loadMadsTab } from '@/lib/meta-ads/console'

const ADMIN = { adminId: 'a1', email: 'a@x.in', role: 'administrator', scopes: [] }
const deny = (status: number) => vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'denied' }, { status }) as any)

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(requireAdminScope).mockResolvedValue(ADMIN as any)
  vi.mocked(currentTenantPlanGate).mockResolvedValue({ allowed: true } as any)
})

const get = (qs = '') => GET(new NextRequest(`http://localhost/api/admin/meta-ads/console${qs}`))
const RANGE = 'from=2026-01-01&to=2026-01-31'

describe('GET /api/admin/meta-ads/console', () => {
  it('401 when not signed in', async () => {
    deny(401)
    expect((await get(`?${RANGE}`)).status).toBe(401)
    expect(loadMadsTab).not.toHaveBeenCalled()
  })

  it('403 without the meta_ads:read scope', async () => {
    deny(403)
    expect((await get(`?${RANGE}`)).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'meta_ads:read')
  })

  it('403 when the plan gate refuses', async () => {
    vi.mocked(currentTenantPlanGate).mockResolvedValue({ allowed: false, upgradeRequired: 'pro' } as any)
    const res = await get(`?${RANGE}`)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ upgradeRequired: 'pro' })
    expect(loadMadsTab).not.toHaveBeenCalled()
  })

  it('400 for an unknown tab', async () => {
    const res = await get(`?tab=bogus&${RANGE}`)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Unknown tab' })
  })

  it('400 for a missing, malformed or reversed date range', async () => {
    for (const qs of ['', '?from=2026-01-01', '?from=1/1/26&to=2/1/26', '?from=2026-02-01&to=2026-01-01']) {
      const res = await get(qs)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'Invalid date range' })
    }
    expect(loadMadsTab).not.toHaveBeenCalled()
  })

  it('loads the tab (overview by default) for the range', async () => {
    vi.mocked(loadMadsTab).mockResolvedValue({ kpis: [1] } as any)
    const res = await get(`?${RANGE}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { kpis: [1] } })
    expect(loadMadsTab).toHaveBeenCalledWith('overview', { from: '2026-01-01', to: '2026-01-31' })
    await get(`?tab=campaigns&${RANGE}`)
    expect(loadMadsTab).toHaveBeenLastCalledWith('campaigns', { from: '2026-01-01', to: '2026-01-31' })
  })

  it('409 telling the admin to connect when the account is not connected', async () => {
    vi.mocked(loadMadsTab).mockRejectedValue(new IntegrationNotConnectedError('x', 't1'))
    const res = await get(`?${RANGE}`)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Connect Meta Ads first.' })
  })

  it('502 when the provider API fails with a 5xx', async () => {
    vi.mocked(loadMadsTab).mockRejectedValue(Object.assign(new Error('upstream down'), { httpStatus: 503 }))
    expect((await get(`?${RANGE}`)).status).toBe(502)
  })
})
