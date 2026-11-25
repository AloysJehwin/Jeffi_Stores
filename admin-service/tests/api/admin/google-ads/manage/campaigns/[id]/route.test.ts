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
vi.mock('@/lib/google-ads/campaigns', () => ({ loadCampaignSettings: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/google-ads/manage/campaigns/[id]/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { currentTenantPlanGate } from '@/lib/auth/plan-gate'
import { IntegrationNotConnectedError } from '@/lib/integrations/resolve'
import { GoogleAdsApiError, GoogleAdsNotConfiguredError } from '@/lib/google-ads/client'
import { AdsMutationError } from '@/lib/google-ads/mutate'
import { googleAdsClientFor } from '@/lib/google-ads/credentials'
import { loadCampaignSettings } from '@/lib/google-ads/campaigns'

const ADMIN = { adminId: 'a1', email: 'a@x.in', role: 'administrator', scopes: [] }
const deny = (status: number) => vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'denied' }, { status }) as any)

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(googleAdsClientFor).mockResolvedValue({ fake: 'ads-client' } as any)
  vi.mocked(requireAdminScope).mockResolvedValue(ADMIN as any)
  vi.mocked(currentTenantPlanGate).mockResolvedValue({ allowed: true } as any)
})

const get = (id = '123') => GET(new NextRequest(`http://localhost/api/admin/google-ads/manage/campaigns/${id}`), { params: Promise.resolve({ id }) })

describe('GET /api/admin/google-ads/manage/campaigns/[id]', () => {
  it('401 when not signed in', async () => {
    deny(401)
    expect((await get()).status).toBe(401)
    expect(loadCampaignSettings).not.toHaveBeenCalled()
  })

  it('403 without the google_ads_campaigns:write scope', async () => {
    deny(403)
    expect((await get()).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'google_ads_campaigns:write')
    expect(loadCampaignSettings).not.toHaveBeenCalled()
  })

  it('403 with the plan to upgrade to when campaign management is not on the plan', async () => {
    vi.mocked(currentTenantPlanGate).mockResolvedValue({ allowed: false, upgradeRequired: 'pro' } as any)
    const res = await get()
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ upgradeRequired: 'pro', error: expect.stringContaining('Pro plan') })
    expect(loadCampaignSettings).not.toHaveBeenCalled()
  })

  it('maps provider errors: 4xx to 400, 5xx to 502, not configured to 503, not connected to 409', async () => {
    const fail = (e: unknown) => vi.mocked(loadCampaignSettings).mockRejectedValueOnce(e)
    fail(new GoogleAdsApiError('bad field', 400, ['E1'], null, false))
    let res = await get()
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'bad field', codes: ['E1'] })
    fail(new GoogleAdsApiError('upstream', 503, [], null, false))
    expect((await get()).status).toBe(502)
    fail(new GoogleAdsNotConfiguredError('no developer token'))
    expect((await get()).status).toBe(503)
    fail(new IntegrationNotConnectedError('x', 't1'))
    expect((await get()).status).toBe(409)
    fail(new AdsMutationError('rejected', 'validate', [], 400))
    res = await get()
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ stage: 'validate' })
    fail(new Error('boom'))
    expect((await get()).status).toBe(500)
  })

  it('400 for an id that is not numeric', async () => {
    for (const id of ['abc', '12;DROP', '1'.repeat(21)]) {
      const res = await get(id)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'Invalid campaign id' })
    }
    expect(loadCampaignSettings).not.toHaveBeenCalled()
  })

  it('404 when Google has no such campaign', async () => {
    vi.mocked(loadCampaignSettings).mockResolvedValue(null as any)
    const res = await get('999')
    expect(res.status).toBe(404)
    expect(loadCampaignSettings).toHaveBeenCalledWith({ fake: 'ads-client' }, '999')
  })

  it('returns the live budget and bid settings', async () => {
    vi.mocked(loadCampaignSettings).mockResolvedValue({ budget: 500, bidding: 'MAXIMIZE_CONVERSIONS' } as any)
    const res = await get('123')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ budget: 500, bidding: 'MAXIMIZE_CONVERSIONS' })
    expect(loadCampaignSettings).toHaveBeenCalledWith({ fake: 'ads-client' }, '123')
  })
})
