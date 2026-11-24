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
vi.mock('@/lib/google-ads/account-create', () => ({ BILLING_URL: 'https://ads.example/billing', billingStatus: vi.fn(), saveBillingStatus: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/google-ads/billing/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { currentTenantPlanGate } from '@/lib/auth/plan-gate'
import { IntegrationNotConnectedError } from '@/lib/integrations/resolve'
import { GoogleAdsApiError, GoogleAdsNotConfiguredError } from '@/lib/google-ads/client'
import { AdsMutationError } from '@/lib/google-ads/mutate'
import { googleAdsClientFor } from '@/lib/google-ads/credentials'
import { billingStatus, saveBillingStatus } from '@/lib/google-ads/account-create'

const ADMIN = { adminId: 'a1', email: 'a@x.in', role: 'administrator', scopes: [] }
const deny = (status: number) => vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'denied' }, { status }) as any)

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(googleAdsClientFor).mockResolvedValue({ fake: 'ads-client' } as any)
  vi.mocked(requireAdminScope).mockResolvedValue(ADMIN as any)
  vi.mocked(currentTenantPlanGate).mockResolvedValue({ allowed: true } as any)
})

const get = () => GET(new NextRequest('http://localhost/api/admin/google-ads/billing'))

describe('GET /api/admin/google-ads/billing', () => {
  it('401 when not signed in', async () => {
    deny(401)
    expect((await get()).status).toBe(401)
    expect(billingStatus).not.toHaveBeenCalled()
  })

  it('403 without the google_ads:read scope', async () => {
    deny(403)
    expect((await get()).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'google_ads:read')
    expect(billingStatus).not.toHaveBeenCalled()
  })

  it('reads the live billing state, mirrors it onto ads_account and returns it with the billing link', async () => {
    vi.mocked(billingStatus).mockResolvedValue({ status: 'APPROVED', hasPayments: true } as any)
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'APPROVED', hasPayments: true, billingUrl: 'https://ads.example/billing' })
    expect(billingStatus).toHaveBeenCalledWith({ fake: 'ads-client' })
    expect(saveBillingStatus).toHaveBeenCalledWith({ status: 'APPROVED', hasPayments: true })
  })

  it('maps provider errors: 4xx to 400, 5xx to 502, not configured to 503, not connected to 409', async () => {
    const fail = (e: unknown) => vi.mocked(billingStatus).mockRejectedValueOnce(e)
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

  it('does not mirror anything when Google fails', async () => {
    vi.mocked(billingStatus).mockRejectedValue(new GoogleAdsApiError('down', 500, [], null, false))
    expect((await get()).status).toBe(502)
    expect(saveBillingStatus).not.toHaveBeenCalled()
  })
})
