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
vi.mock('@/lib/google-ads/geo', () => ({ resolveStateNames: vi.fn(), suggestGeo: vi.fn() }))

import { GET, POST } from '@admin/app/api/(admin)/admin/google-ads/manage/geo/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { currentTenantPlanGate } from '@/lib/auth/plan-gate'
import { IntegrationNotConnectedError } from '@/lib/integrations/resolve'
import { GoogleAdsApiError, GoogleAdsNotConfiguredError } from '@/lib/google-ads/client'
import { AdsMutationError } from '@/lib/google-ads/mutate'
import { googleAdsClientFor } from '@/lib/google-ads/credentials'
import { resolveStateNames, suggestGeo } from '@/lib/google-ads/geo'

const ADMIN = { adminId: 'a1', email: 'a@x.in', role: 'administrator', scopes: [] }
const deny = (status: number) => vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'denied' }, { status }) as any)

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(googleAdsClientFor).mockResolvedValue({ fake: 'ads-client' } as any)
  vi.mocked(requireAdminScope).mockResolvedValue(ADMIN as any)
  vi.mocked(currentTenantPlanGate).mockResolvedValue({ allowed: true } as any)
})

const get = (qs = '?q=Kochi') => GET(new NextRequest(`http://localhost/api/admin/google-ads/manage/geo${qs}`))
const post = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/admin/google-ads/manage/geo', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }))

describe('GET /api/admin/google-ads/manage/geo', () => {
  it('401 when not signed in', async () => {
    deny(401)
    expect((await get()).status).toBe(401)
    expect(suggestGeo).not.toHaveBeenCalled()
  })

  it('403 without the google_ads_campaigns:write scope', async () => {
    deny(403)
    expect((await get()).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'google_ads_campaigns:write')
    expect(suggestGeo).not.toHaveBeenCalled()
  })

  it('403 with the plan to upgrade to when campaign management is not on the plan', async () => {
    vi.mocked(currentTenantPlanGate).mockResolvedValue({ allowed: false, upgradeRequired: 'pro' } as any)
    const res = await get()
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ upgradeRequired: 'pro', error: expect.stringContaining('Pro plan') })
    expect(suggestGeo).not.toHaveBeenCalled()
  })

  it('maps provider errors: 4xx to 400, 5xx to 502, not configured to 503, not connected to 409', async () => {
    const fail = (e: unknown) => vi.mocked(suggestGeo).mockRejectedValueOnce(e)
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

  it('suggests geo targets for the query', async () => {
    vi.mocked(suggestGeo).mockResolvedValue([{ name: 'Kochi' }] as any)
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ options: [{ name: 'Kochi' }] })
    expect(suggestGeo).toHaveBeenCalledWith({ fake: 'ads-client' }, 'Kochi')
    await get('')
    expect(suggestGeo).toHaveBeenLastCalledWith({ fake: 'ads-client' }, '')
  })
})

describe('POST /api/admin/google-ads/manage/geo', () => {
  it('401 when not signed in', async () => {
    deny(401)
    expect((await post({ names: ['Kerala'] })).status).toBe(401)
    expect(resolveStateNames).not.toHaveBeenCalled()
  })

  it('403 without the google_ads_campaigns:write scope', async () => {
    deny(403)
    expect((await post({ names: ['Kerala'] })).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'google_ads_campaigns:write')
    expect(resolveStateNames).not.toHaveBeenCalled()
  })

  it('403 with the plan to upgrade to when campaign management is not on the plan', async () => {
    vi.mocked(currentTenantPlanGate).mockResolvedValue({ allowed: false, upgradeRequired: 'pro' } as any)
    const res = await post({ names: ['Kerala'] })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ upgradeRequired: 'pro', error: expect.stringContaining('Pro plan') })
    expect(resolveStateNames).not.toHaveBeenCalled()
  })

  it('maps provider errors: 4xx to 400, 5xx to 502, not configured to 503, not connected to 409', async () => {
    const fail = (e: unknown) => vi.mocked(resolveStateNames).mockRejectedValueOnce(e)
    fail(new GoogleAdsApiError('bad field', 400, ['E1'], null, false))
    let res = await post({ names: ['Kerala'] })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'bad field', codes: ['E1'] })
    fail(new GoogleAdsApiError('upstream', 503, [], null, false))
    expect((await post({ names: ['Kerala'] })).status).toBe(502)
    fail(new GoogleAdsNotConfiguredError('no developer token'))
    expect((await post({ names: ['Kerala'] })).status).toBe(503)
    fail(new IntegrationNotConnectedError('x', 't1'))
    expect((await post({ names: ['Kerala'] })).status).toBe(409)
    fail(new AdsMutationError('rejected', 'validate', [], 400))
    res = await post({ names: ['Kerala'] })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ stage: 'validate' })
    fail(new Error('boom'))
    expect((await post({ names: ['Kerala'] })).status).toBe(500)
  })

  it('400 for missing, empty, oversized or non-string names', async () => {
    for (const body of ['not json', {}, { names: [] }, { names: ['  '] }, { names: [1] }, { names: Array(51).fill('Kerala') }]) {
      const res = await post(body)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'Send the state names to resolve' })
    }
    expect(resolveStateNames).not.toHaveBeenCalled()
  })

  it('resolves the trimmed state names to geo targets', async () => {
    vi.mocked(resolveStateNames).mockResolvedValue({ resolved: ['geoTargetConstants/1'], unresolved: [] } as any)
    const res = await post({ names: [' Kerala ', 'Goa'] })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ resolved: ['geoTargetConstants/1'], unresolved: [] })
    expect(resolveStateNames).toHaveBeenCalledWith({ fake: 'ads-client' }, ['Kerala', 'Goa'])
  })
})
