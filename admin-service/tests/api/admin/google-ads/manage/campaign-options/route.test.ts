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
vi.mock('@/lib/google-ads/campaign-spec', () => ({ DEMAND_GEN_MIN_DAILY_FALLBACK: 50 }))
vi.mock('@/lib/google-ads/image-ads', () => ({ demandGenMinimumDaily: vi.fn(), listAudiences: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/google-ads/manage/campaign-options/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { currentTenantPlanGate } from '@/lib/auth/plan-gate'
import { IntegrationNotConnectedError } from '@/lib/integrations/resolve'
import { GoogleAdsApiError, GoogleAdsNotConfiguredError } from '@/lib/google-ads/client'
import { AdsMutationError } from '@/lib/google-ads/mutate'
import { googleAdsClientFor } from '@/lib/google-ads/credentials'
import { queryOne } from '@/lib/shared/db'
import { demandGenMinimumDaily, listAudiences } from '@/lib/google-ads/image-ads'

const ADMIN = { adminId: 'a1', email: 'a@x.in', role: 'administrator', scopes: [] }
const deny = (status: number) => vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'denied' }, { status }) as any)

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(googleAdsClientFor).mockResolvedValue({ fake: 'ads-client' } as any)
  vi.mocked(requireAdminScope).mockResolvedValue(ADMIN as any)
  vi.mocked(currentTenantPlanGate).mockResolvedValue({ allowed: true } as any)
})

const get = () => GET(new NextRequest('http://localhost/api/admin/google-ads/manage/campaign-options'))

describe('GET /api/admin/google-ads/manage/campaign-options', () => {
  it('401 when not signed in', async () => {
    deny(401)
    expect((await get()).status).toBe(401)
    expect(demandGenMinimumDaily).not.toHaveBeenCalled()
  })

  it('403 without the google_ads_campaigns:write scope', async () => {
    deny(403)
    expect((await get()).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'google_ads_campaigns:write')
    expect(demandGenMinimumDaily).not.toHaveBeenCalled()
  })

  it('403 with the plan to upgrade to when campaign management is not on the plan', async () => {
    vi.mocked(currentTenantPlanGate).mockResolvedValue({ allowed: false, upgradeRequired: 'pro' } as any)
    const res = await get()
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ upgradeRequired: 'pro', error: expect.stringContaining('Pro plan') })
    expect(demandGenMinimumDaily).not.toHaveBeenCalled()
  })

  it('returns the currency, Google minimum and audiences', async () => {
    vi.mocked(queryOne).mockResolvedValue({ c: 'USD' } as any)
    vi.mocked(demandGenMinimumDaily).mockResolvedValue(12 as any)
    vi.mocked(listAudiences).mockResolvedValue([{ id: 'aud1' }] as any)
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      currency: 'USD',
      demandGenMinimum: 12,
      demandGenMinimumFromGoogle: true,
      audiences: [{ id: 'aud1' }],
      audiencesError: null,
    })
    expect(demandGenMinimumDaily).toHaveBeenCalledWith({ fake: 'ads-client' }, 'USD')
  })

  it('falls back to INR and the default minimum, and reports an audiences failure without failing', async () => {
    vi.mocked(queryOne).mockRejectedValue(new Error('no table'))
    vi.mocked(demandGenMinimumDaily).mockResolvedValue(null as any)
    vi.mocked(listAudiences).mockRejectedValue(new Error('audience api down'))
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      currency: 'INR',
      demandGenMinimum: 50,
      demandGenMinimumFromGoogle: false,
      audiences: [],
      audiencesError: 'audience api down',
    })
  })

  it('maps a Google failure on the minimum to 502, and a missing connection to 409', async () => {
    vi.mocked(queryOne).mockResolvedValue({ c: 'INR' } as any)
    vi.mocked(listAudiences).mockResolvedValue([] as any)
    vi.mocked(demandGenMinimumDaily).mockRejectedValueOnce(new GoogleAdsApiError('upstream', 500, [], null, false))
    expect((await get()).status).toBe(502)
    vi.mocked(googleAdsClientFor).mockRejectedValueOnce(new IntegrationNotConnectedError('x', 't1'))
    expect((await get()).status).toBe(409)
  })
})
