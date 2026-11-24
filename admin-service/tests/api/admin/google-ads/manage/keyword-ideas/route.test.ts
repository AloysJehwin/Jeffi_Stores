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
vi.mock('@/lib/google-ads/keywords', () => ({ catalogueSeeds: vi.fn(), generateKeywordIdeas: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/google-ads/manage/keyword-ideas/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { currentTenantPlanGate } from '@/lib/auth/plan-gate'
import { IntegrationNotConnectedError } from '@/lib/integrations/resolve'
import { GoogleAdsApiError, GoogleAdsNotConfiguredError } from '@/lib/google-ads/client'
import { AdsMutationError } from '@/lib/google-ads/mutate'
import { googleAdsClientFor } from '@/lib/google-ads/credentials'
import { catalogueSeeds, generateKeywordIdeas } from '@/lib/google-ads/keywords'

const ADMIN = { adminId: 'a1', email: 'a@x.in', role: 'administrator', scopes: [] }
const deny = (status: number) => vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'denied' }, { status }) as any)

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(googleAdsClientFor).mockResolvedValue({ fake: 'ads-client' } as any)
  vi.mocked(requireAdminScope).mockResolvedValue(ADMIN as any)
  vi.mocked(currentTenantPlanGate).mockResolvedValue({ allowed: true } as any)
})

const post = (body: unknown = {}) =>
  POST(new NextRequest('http://localhost/api/admin/google-ads/manage/keyword-ideas', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }))
const CAT = '11111111-2222-3333-4444-555555555555'

describe('POST /api/admin/google-ads/manage/keyword-ideas', () => {
  it('401 when not signed in', async () => {
    deny(401)
    expect((await post()).status).toBe(401)
    expect(catalogueSeeds).not.toHaveBeenCalled()
  })

  it('403 without the google_ads_campaigns:write scope', async () => {
    deny(403)
    expect((await post()).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'google_ads_campaigns:write')
    expect(catalogueSeeds).not.toHaveBeenCalled()
  })

  it('403 with the plan to upgrade to when campaign management is not on the plan', async () => {
    vi.mocked(currentTenantPlanGate).mockResolvedValue({ allowed: false, upgradeRequired: 'pro' } as any)
    const res = await post()
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ upgradeRequired: 'pro', error: expect.stringContaining('Pro plan') })
    expect(catalogueSeeds).not.toHaveBeenCalled()
  })

  it('maps provider errors: 4xx to 400, 5xx to 502, not configured to 503, not connected to 409', async () => {
    const fail = (e: unknown) => vi.mocked(catalogueSeeds).mockRejectedValueOnce(e)
    fail(new GoogleAdsApiError('bad field', 400, ['E1'], null, false))
    let res = await post()
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'bad field', codes: ['E1'] })
    fail(new GoogleAdsApiError('upstream', 503, [], null, false))
    expect((await post()).status).toBe(502)
    fail(new GoogleAdsNotConfiguredError('no developer token'))
    expect((await post()).status).toBe(503)
    fail(new IntegrationNotConnectedError('x', 't1'))
    expect((await post()).status).toBe(409)
    fail(new AdsMutationError('rejected', 'validate', [], 400))
    res = await post()
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ stage: 'validate' })
    fail(new Error('boom'))
    expect((await post()).status).toBe(500)
  })

  it('400 for a bad category id, url, language or location', async () => {
    for (const body of [{ categoryId: 'nope' }, { url: 'ftp://x' }, { language: 'en' }, { locations: ['Kerala'] }, { seeds: Array(21).fill('a') }]) {
      expect((await post(body)).status).toBe(400)
    }
    expect(catalogueSeeds).not.toHaveBeenCalled()
  })

  it('merges the admin seeds with the catalogue seeds and returns the Planner ideas', async () => {
    vi.mocked(catalogueSeeds).mockResolvedValue({ seeds: ['sneakers', 'boots'], categoryName: 'Shoes' } as any)
    vi.mocked(generateKeywordIdeas).mockResolvedValue([{ text: 'running sneakers' }] as any)
    const res = await post({ categoryId: CAT, seeds: ['boots', 'loafers'], url: 'https://shop.example', language: 'languageConstants/1000', locations: ['geoTargetConstants/9'] })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ seeds: ['boots', 'loafers', 'sneakers'], categoryName: 'Shoes', ideas: [{ text: 'running sneakers' }], ideasError: null })
    expect(catalogueSeeds).toHaveBeenCalledWith(CAT)
    expect(generateKeywordIdeas).toHaveBeenCalledWith({ fake: 'ads-client' }, {
      seeds: ['boots', 'loafers', 'sneakers'],
      url: 'https://shop.example',
      language: 'languageConstants/1000',
      locations: ['geoTargetConstants/9'],
    })
  })

  it('works with no body and still returns the catalogue seeds when Keyword Planner fails', async () => {
    vi.mocked(catalogueSeeds).mockResolvedValue({ seeds: ['sneakers'], categoryName: null } as any)
    vi.mocked(generateKeywordIdeas).mockRejectedValue(new Error('developer token not approved'))
    const res = await post('not json')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ seeds: ['sneakers'], categoryName: null, ideas: [], ideasError: 'developer token not approved' })
    expect(catalogueSeeds).toHaveBeenCalledWith(null)
  })

  it('maps a failure outside the Planner call to the documented status', async () => {
    vi.mocked(catalogueSeeds).mockRejectedValueOnce(new GoogleAdsApiError('upstream', 503, [], null, false))
    expect((await post()).status).toBe(502)
    vi.mocked(catalogueSeeds).mockRejectedValueOnce(new Error('db down'))
    expect((await post()).status).toBe(500)
  })
})
