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
vi.mock('@/lib/google-ads/digest', () => ({ collectDigest: vi.fn(), sendWeeklyDigest: vi.fn() }))

import { GET, POST } from '@admin/app/api/(admin)/admin/google-ads/digest/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { currentTenantPlanGate } from '@/lib/auth/plan-gate'
import { IntegrationNotConnectedError } from '@/lib/integrations/resolve'
import { GoogleAdsApiError, GoogleAdsNotConfiguredError } from '@/lib/google-ads/client'
import { AdsMutationError } from '@/lib/google-ads/mutate'
import { googleAdsClientFor } from '@/lib/google-ads/credentials'
import { collectDigest, sendWeeklyDigest } from '@/lib/google-ads/digest'

const ADMIN = { adminId: 'a1', email: 'a@x.in', role: 'administrator', scopes: [] }
const deny = (status: number) => vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'denied' }, { status }) as any)

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(googleAdsClientFor).mockResolvedValue({ fake: 'ads-client' } as any)
  vi.mocked(requireAdminScope).mockResolvedValue(ADMIN as any)
  vi.mocked(currentTenantPlanGate).mockResolvedValue({ allowed: true } as any)
})

const get = () => GET(new NextRequest('http://localhost/api/admin/google-ads/digest'))
const post = (body?: unknown) =>
  POST(new NextRequest('http://localhost/api/admin/google-ads/digest', { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }))

describe('GET /api/admin/google-ads/digest', () => {
  it('401 when not signed in', async () => {
    deny(401)
    expect((await get()).status).toBe(401)
    expect(collectDigest).not.toHaveBeenCalled()
  })

  it('403 without the google_ads:read scope', async () => {
    deny(403)
    expect((await get()).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'google_ads:read')
    expect(collectDigest).not.toHaveBeenCalled()
  })

  it('returns the digest numbers', async () => {
    vi.mocked(collectDigest).mockResolvedValue({ spend: 100 } as any)
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ spend: 100 })
  })
})

describe('POST /api/admin/google-ads/digest', () => {
  it('401 when not signed in', async () => {
    deny(401)
    expect((await post({ to: 'me' })).status).toBe(401)
    expect(sendWeeklyDigest).not.toHaveBeenCalled()
  })

  it('403 without the google_ads:write scope', async () => {
    deny(403)
    expect((await post({ to: 'me' })).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'google_ads:write')
    expect(sendWeeklyDigest).not.toHaveBeenCalled()
  })

  it('400 when sending to me and the account has no email address', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
    const res = await post({ to: 'me' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Your account has no email address' })
    expect(sendWeeklyDigest).not.toHaveBeenCalled()
  })

  it('sends the digest to the admin only for to=me (also the default)', async () => {
    vi.mocked(sendWeeklyDigest).mockResolvedValue({ sent: 1 } as any)
    const res = await post({ to: 'me' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sent: 1 })
    expect(sendWeeklyDigest).toHaveBeenCalledWith({ to: ['a@x.in'] })
    await post()
    expect(sendWeeklyDigest).toHaveBeenLastCalledWith({ to: ['a@x.in'] })
  })

  it('forces the send to everyone with Google Ads access for to=all, even without an email on the admin', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
    vi.mocked(sendWeeklyDigest).mockResolvedValue({ sent: 5 } as any)
    expect((await post({ to: 'all' })).status).toBe(200)
    expect(sendWeeklyDigest).toHaveBeenCalledWith({ force: true })
  })

  it('500 with the message when sending fails', async () => {
    vi.mocked(sendWeeklyDigest).mockRejectedValue(new Error('SES down'))
    const res = await post({ to: 'me' })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'SES down' })
  })
})
