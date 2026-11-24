import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), getClient: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/integrations/resolve', () => ({ IntegrationNotConnectedError: class IntegrationNotConnectedError extends Error {} }))

vi.mock('@/lib/marketplace-ads/console', () => ({ MADS_TABS: ['overview', 'campaigns', 'products', 'imports'], loadMadsTab: vi.fn() }))
vi.mock('@/lib/marketplace-ads/import', () => ({
  MAX_BYTES: 10 * 1024 * 1024,
  ReportError: class ReportError extends Error {},
  commitImport: vi.fn(),
  previewImport: vi.fn(),
}))

import { GET } from '@admin/app/api/(admin)/admin/flipkart-ads/console/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { currentTenantPlanGate } from '@/lib/auth/plan-gate'
import { IntegrationNotConnectedError } from '@/lib/integrations/resolve'
import { loadMadsTab } from '@/lib/marketplace-ads/console'

const ADMIN = { adminId: 'a1', email: 'a@x.in', role: 'administrator', scopes: [] }
const deny = (status: number) => vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'denied' }, { status }) as any)

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(requireAdminScope).mockResolvedValue(ADMIN as any)
  vi.mocked(currentTenantPlanGate).mockResolvedValue({ allowed: true } as any)
})

const get = (qs = '') => GET(new NextRequest(`http://localhost/api/admin/flipkart-ads/console${qs}`))
const RANGE = 'from=2026-01-01&to=2026-01-31'

describe('GET /api/admin/flipkart-ads/console', () => {
  it('401 when not signed in', async () => {
    deny(401)
    expect((await get(`?${RANGE}`)).status).toBe(401)
    expect(loadMadsTab).not.toHaveBeenCalled()
  })

  it('403 without the flipkart_ads:read scope', async () => {
    deny(403)
    expect((await get(`?${RANGE}`)).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'flipkart_ads:read')
    expect(loadMadsTab).not.toHaveBeenCalled()
  })

  it('403 with the upgrade plan when the plan lacks Flipkart Ads', async () => {
    vi.mocked(currentTenantPlanGate).mockResolvedValue({ allowed: false, upgradeRequired: 'growth' } as any)
    const res = await get(`?${RANGE}`)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ upgradeRequired: 'growth', error: expect.stringContaining('Growth plan') })
    expect(loadMadsTab).not.toHaveBeenCalled()
  })

  it('400 for an unknown tab', async () => {
    const res = await get(`?tab=bogus&${RANGE}`)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Unknown tab' })
  })

  it('400 for a missing or reversed date range', async () => {
    expect((await get('?tab=overview')).status).toBe(400)
    expect((await get('?tab=overview&from=2026-02-01&to=2026-01-01')).status).toBe(400)
    expect(loadMadsTab).not.toHaveBeenCalled()
  })

  it('loads the tab for the channel and range', async () => {
    vi.mocked(loadMadsTab).mockResolvedValue({ rows: [1] } as any)
    const res = await get(`?tab=campaigns&${RANGE}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { rows: [1] } })
    expect(loadMadsTab).toHaveBeenCalledWith('flipkart_ads', 'campaigns', { from: '2026-01-01', to: '2026-01-31' })
  })

  it('the imports tab needs no date range', async () => {
    vi.mocked(loadMadsTab).mockResolvedValue([] as any)
    expect((await get('?tab=imports')).status).toBe(200)
    expect(loadMadsTab).toHaveBeenCalledWith('flipkart_ads', 'imports', { from: '', to: '' })
  })

  it('409 when the channel is not connected', async () => {
    vi.mocked(loadMadsTab).mockRejectedValue(new IntegrationNotConnectedError('x', 't1'))
    expect((await get(`?${RANGE}`)).status).toBe(409)
  })

  it('500 when the loader throws', async () => {
    vi.mocked(loadMadsTab).mockRejectedValue(new Error('db down'))
    const res = await get(`?${RANGE}`)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'db down' })
  })
})
