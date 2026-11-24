import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), getClient: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/integrations/resolve', () => ({ IntegrationNotConnectedError: class IntegrationNotConnectedError extends Error {} }))
vi.mock('@/lib/google-ads/client', () => ({
  GoogleAdsApiError: class GoogleAdsApiError extends Error {
    httpStatus: number
    codes: string[]
    constructor(message: string, httpStatus: number, codes: string[] = []) {
      super(message)
      this.httpStatus = httpStatus
      this.codes = codes
    }
  },
  GoogleAdsNotConfiguredError: class GoogleAdsNotConfiguredError extends Error {},
}))
vi.mock('@/lib/google-ads/mutate', () => ({
  AdsMutationError: class AdsMutationError extends Error {
    stage: string
    problems: unknown[]
    httpStatus: number
    requestId: string | null
    constructor(message: string, stage: string, problems: unknown[], httpStatus: number, requestId: string | null = null) {
      super(message)
      this.stage = stage
      this.problems = problems
      this.httpStatus = httpStatus
      this.requestId = requestId
    }
  },
}))
vi.mock('@/lib/google-ads/credentials', () => ({ googleAdsClientFor: vi.fn(async () => ({ fake: 'ads-client' })), googleAdsEnvStatus: vi.fn(), resolveGoogleAdsCreds: vi.fn() }))
vi.mock('@/lib/google-ads/audiences/attach', () => ({ listAssetGroups: vi.fn() }))
vi.mock('@/lib/google-ads/audiences/refresh', () => ({
  AudienceRefreshInProgressError: class AudienceRefreshInProgressError extends Error {
    constructor() {
      super('Audience lists are already refreshing.')
    }
  },
  acceptCustomerMatchTerms: vi.fn(),
  loadAudiences: vi.fn(),
  refreshAudiences: vi.fn(),
  saveAudienceSetting: vi.fn(),
}))
vi.mock('@/lib/google-ads/audiences/segments', async () => {
  const { z } = await import('zod')
  return { SEGMENTS: ['all_customers', 'lapsed'], SegmentParamsSchema: z.object({ days: z.number().optional() }) }
})

import { GET, POST } from '@admin/app/api/(admin)/admin/google-ads/audiences/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { currentTenantPlanGate } from '@/lib/auth/plan-gate'
import { IntegrationNotConnectedError } from '@/lib/integrations/resolve'
import { GoogleAdsApiError, GoogleAdsNotConfiguredError } from '@/lib/google-ads/client'
import { AdsMutationError } from '@/lib/google-ads/mutate'
import { googleAdsClientFor } from '@/lib/google-ads/credentials'
import { listAssetGroups } from '@/lib/google-ads/audiences/attach'
import { AudienceRefreshInProgressError, acceptCustomerMatchTerms, loadAudiences, refreshAudiences, saveAudienceSetting } from '@/lib/google-ads/audiences/refresh'

const ADMIN = { adminId: 'a1', email: 'a@x.in', role: 'administrator', scopes: [] }
const deny = (status: number) => vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'denied' }, { status }) as any)

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(googleAdsClientFor).mockResolvedValue({ fake: 'ads-client' } as any)
  vi.mocked(loadAudiences).mockResolvedValue({ lists: [] } as any)
  vi.mocked(requireAdminScope).mockResolvedValue(ADMIN as any)
  vi.mocked(currentTenantPlanGate).mockResolvedValue({ allowed: true } as any)
})

const url = 'http://localhost/api/admin/google-ads/audiences'
const get = (qs = '') => GET(new NextRequest(url + qs))
const post = (body: unknown) => POST(new NextRequest(url, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }))

describe('GET /api/admin/google-ads/audiences', () => {
  it('401 when not signed in', async () => {
    deny(401)
    expect((await get()).status).toBe(401)
    expect(loadAudiences).not.toHaveBeenCalled()
  })

  it('403 without the google_ads:read scope', async () => {
    deny(403)
    expect((await get()).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'google_ads:read')
    expect(loadAudiences).not.toHaveBeenCalled()
  })

  it('returns the Customer Match lists', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ lists: [] })
  })

  it('?assetGroups=<id> needs the campaign write scope and the Pro plan, then lists asset groups', async () => {
    deny(403)
    expect((await get('?assetGroups=55')).status).toBe(403)
    expect(requireAdminScope).toHaveBeenLastCalledWith(expect.anything(), 'google_ads_campaigns:write')
    vi.mocked(currentTenantPlanGate).mockResolvedValueOnce({ allowed: false, upgradeRequired: 'pro' } as any)
    expect((await get('?assetGroups=55')).status).toBe(403)
    vi.mocked(listAssetGroups).mockResolvedValue([{ id: 'ag1' }] as any)
    const res = await get('?assetGroups=55')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ assetGroups: [{ id: 'ag1' }] })
    expect(listAssetGroups).toHaveBeenCalledWith({ fake: 'ads-client' }, '55')
  })

  it('maps a Google failure listing asset groups to 502', async () => {
    vi.mocked(listAssetGroups).mockRejectedValue(new GoogleAdsApiError('upstream', 500, [], null, false))
    expect((await get('?assetGroups=55')).status).toBe(502)
  })
})

describe('POST /api/admin/google-ads/audiences', () => {
  it('401 when not signed in', async () => {
    deny(401)
    expect((await post({ op: 'terms', accept: true })).status).toBe(401)
    expect(acceptCustomerMatchTerms).not.toHaveBeenCalled()
  })

  it('403 without the google_ads:write scope', async () => {
    deny(403)
    expect((await post({ op: 'terms', accept: true })).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'google_ads:write')
    expect(acceptCustomerMatchTerms).not.toHaveBeenCalled()
  })

  it('400 for an unknown op, an unknown segment or terms not accepted', async () => {
    for (const body of ['not json', { op: 'nuke' }, { op: 'settings', segment: 'nobody', enabled: true }, { op: 'terms', accept: false }, { op: 'refresh', segment: 'nobody' }]) {
      expect((await post(body)).status).toBe(400)
    }
    expect(saveAudienceSetting).not.toHaveBeenCalled()
    expect(refreshAudiences).not.toHaveBeenCalled()
  })

  it('saves a segment setting and returns the fresh lists', async () => {
    const res = await post({ op: 'settings', segment: 'lapsed', enabled: true, params: { days: 90 } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { lists: [] } })
    expect(saveAudienceSetting).toHaveBeenCalledWith('lapsed', true, { days: 90 })
  })

  it('accepts the Customer Match terms', async () => {
    expect((await post({ op: 'terms', accept: true })).status).toBe(200)
    expect(acceptCustomerMatchTerms).toHaveBeenCalledTimes(1)
  })

  it('refreshes now as the admin, for one segment or all', async () => {
    vi.mocked(refreshAudiences).mockResolvedValue({ status: 'success' } as any)
    const res = await post({ op: 'refresh', segment: 'lapsed' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ run: { status: 'success' }, data: { lists: [] } })
    expect(refreshAudiences).toHaveBeenCalledWith({ actor: { adminId: 'a1', email: 'a@x.in' }, only: 'lapsed' })
    await post({ op: 'refresh' })
    expect(refreshAudiences).toHaveBeenLastCalledWith({ actor: { adminId: 'a1', email: 'a@x.in' }, only: undefined })
  })

  it('409 when a refresh is already running', async () => {
    vi.mocked(refreshAudiences).mockRejectedValue(new AudienceRefreshInProgressError())
    const res = await post({ op: 'refresh' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Audience lists are already refreshing.' })
  })

  it('maps a Google failure to 502 and a missing connection to 409', async () => {
    vi.mocked(refreshAudiences).mockRejectedValueOnce(new GoogleAdsApiError('upstream', 500, [], null, false))
    expect((await post({ op: 'refresh' })).status).toBe(502)
    vi.mocked(acceptCustomerMatchTerms).mockRejectedValueOnce(new IntegrationNotConnectedError('x', 't1'))
    expect((await post({ op: 'terms', accept: true })).status).toBe(409)
  })
})
