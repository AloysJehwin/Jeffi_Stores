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
vi.mock('@/lib/google-ads/alerts', async () => {
  const { z } = await import('zod')
  return {
    AlertConfigSchema: z.object({ roasFloor: z.number().min(0) }),
    dismissAlert: vi.fn(),
    getAlertConfig: vi.fn(),
    getNotifySettings: vi.fn(),
    listAlerts: vi.fn(),
    runAdsAlerts: vi.fn(),
    saveAlertSettings: vi.fn(),
  }
})

import { GET, PUT, POST } from '@admin/app/api/(admin)/admin/google-ads/alerts/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { currentTenantPlanGate } from '@/lib/auth/plan-gate'
import { IntegrationNotConnectedError } from '@/lib/integrations/resolve'
import { GoogleAdsApiError, GoogleAdsNotConfiguredError } from '@/lib/google-ads/client'
import { AdsMutationError } from '@/lib/google-ads/mutate'
import { googleAdsClientFor } from '@/lib/google-ads/credentials'
import { dismissAlert, getAlertConfig, getNotifySettings, listAlerts, runAdsAlerts, saveAlertSettings } from '@/lib/google-ads/alerts'

const ADMIN = { adminId: 'a1', email: 'a@x.in', role: 'administrator', scopes: [] }
const deny = (status: number) => vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'denied' }, { status }) as any)

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(googleAdsClientFor).mockResolvedValue({ fake: 'ads-client' } as any)
  vi.mocked(listAlerts).mockResolvedValue([{ id: '7' }] as any)
  vi.mocked(getAlertConfig).mockResolvedValue({ roasFloor: 2 } as any)
  vi.mocked(getNotifySettings).mockResolvedValue({ emails: true, digest: false } as any)
  vi.mocked(requireAdminScope).mockResolvedValue(ADMIN as any)
  vi.mocked(currentTenantPlanGate).mockResolvedValue({ allowed: true } as any)
})

const PAYLOAD = { alerts: [{ id: '7' }], config: { roasFloor: 2 }, notify: { emails: true, digest: false } }
const url = 'http://localhost/api/admin/google-ads/alerts'
const get = () => GET(new NextRequest(url))
const put = (body: unknown) => PUT(new NextRequest(url, { method: 'PUT', body: typeof body === 'string' ? body : JSON.stringify(body) }))
const post = (body: unknown) => POST(new NextRequest(url, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }))

describe('GET /api/admin/google-ads/alerts', () => {
  it('401 when not signed in', async () => {
    deny(401)
    expect((await get()).status).toBe(401)
    expect(listAlerts).not.toHaveBeenCalled()
  })

  it('403 without the google_ads:read scope', async () => {
    deny(403)
    expect((await get()).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'google_ads:read')
    expect(listAlerts).not.toHaveBeenCalled()
  })

  it('returns the alerts with the thresholds and notification settings', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(PAYLOAD)
  })

  it('lets a database failure surface (no handler in the route)', async () => {
    vi.mocked(listAlerts).mockRejectedValue(new Error('db down'))
    await expect(get()).rejects.toThrow('db down')
  })
})

describe('PUT /api/admin/google-ads/alerts', () => {
  it('401 when not signed in', async () => {
    deny(401)
    expect((await put({})).status).toBe(401)
    expect(saveAlertSettings).not.toHaveBeenCalled()
  })

  it('403 without the google_ads:write scope', async () => {
    deny(403)
    expect((await put({})).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'google_ads:write')
    expect(saveAlertSettings).not.toHaveBeenCalled()
  })

  it('400 for invalid settings', async () => {
    for (const body of ['not json', {}, { config: { roasFloor: -1 }, notify: { emails: true, digest: true } }, { config: { roasFloor: 1 }, notify: { emails: 'yes' } }]) {
      expect((await put(body)).status).toBe(400)
    }
    expect(saveAlertSettings).not.toHaveBeenCalled()
  })

  it('saves the thresholds and notify switches and returns the fresh payload', async () => {
    const res = await put({ config: { roasFloor: 3 }, notify: { emails: false, digest: true } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(PAYLOAD)
    expect(saveAlertSettings).toHaveBeenCalledWith({ roasFloor: 3 }, { emails: false, digest: true })
  })
})

describe('POST /api/admin/google-ads/alerts', () => {
  it('401 when not signed in', async () => {
    deny(401)
    expect((await post({ op: 'evaluate' })).status).toBe(401)
    expect(runAdsAlerts).not.toHaveBeenCalled()
  })

  it('403 without the google_ads:write scope', async () => {
    deny(403)
    expect((await post({ op: 'evaluate' })).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'google_ads:write')
    expect(runAdsAlerts).not.toHaveBeenCalled()
  })

  it('400 for an unknown op or a bad alert id', async () => {
    for (const body of ['not json', { op: 'nuke' }, { op: 'dismiss' }, { op: 'dismiss', id: 'abc' }]) {
      expect((await post(body)).status).toBe(400)
    }
    expect(dismissAlert).not.toHaveBeenCalled()
    expect(runAdsAlerts).not.toHaveBeenCalled()
  })

  it('dismisses an alert as the admin', async () => {
    const res = await post({ op: 'dismiss', id: '7' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(PAYLOAD)
    expect(dismissAlert).toHaveBeenCalledWith('7', 'a@x.in')
    expect(runAdsAlerts).not.toHaveBeenCalled()
  })

  it('evaluates the alert rules now', async () => {
    expect((await post({ op: 'evaluate' })).status).toBe(200)
    expect(runAdsAlerts).toHaveBeenCalledTimes(1)
    expect(dismissAlert).not.toHaveBeenCalled()
  })
})
