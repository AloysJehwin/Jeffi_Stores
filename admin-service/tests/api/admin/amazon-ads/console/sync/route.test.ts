import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), getClient: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/integrations/resolve', () => ({ IntegrationNotConnectedError: class IntegrationNotConnectedError extends Error {} }))

vi.mock('@/lib/amazon-ads/sync', () => ({ syncAmazonAds: vi.fn() }))
vi.mock('@/lib/channels/alerts-engine', () => ({ runChannelAlerts: vi.fn() }))
vi.mock('@/lib/amazon-ads/alerts', () => ({ AMAZON_ADS_RULES: ['rule'] }))

import { POST } from '@admin/app/api/(admin)/admin/amazon-ads/console/sync/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { currentTenantPlanGate } from '@/lib/auth/plan-gate'
import { IntegrationNotConnectedError } from '@/lib/integrations/resolve'
import { runChannelAlerts } from '@/lib/channels/alerts-engine'
import { ChannelJobBusyError } from '@/lib/channels/sync-run'
import { syncAmazonAds } from '@/lib/amazon-ads/sync'

const ADMIN = { adminId: 'a1', email: 'a@x.in', role: 'administrator', scopes: [] }
const deny = (status: number) => vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'denied' }, { status }) as any)

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(requireAdminScope).mockResolvedValue(ADMIN as any)
  vi.mocked(currentTenantPlanGate).mockResolvedValue({ allowed: true } as any)
})

const post = (body?: unknown) =>
  POST(new NextRequest('http://localhost/api/admin/amazon-ads/console/sync', { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }))

describe('POST /api/admin/amazon-ads/console/sync', () => {
  it('401 when not signed in', async () => {
    deny(401)
    expect((await post()).status).toBe(401)
    expect(syncAmazonAds).not.toHaveBeenCalled()
  })

  it('403 without the amazon_ads:write scope', async () => {
    deny(403)
    expect((await post()).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'amazon_ads:write')
    expect(syncAmazonAds).not.toHaveBeenCalled()
  })

  it('403 when the plan gate refuses', async () => {
    vi.mocked(currentTenantPlanGate).mockResolvedValue({ allowed: false } as any)
    expect((await post()).status).toBe(403)
    expect(syncAmazonAds).not.toHaveBeenCalled()
  })

  it('starts the sync and returns its result with the alerts it raised', async () => {
    vi.mocked(syncAmazonAds).mockResolvedValue({ status: 'success', counts: { campaigns: 2 } } as any)
    vi.mocked(runChannelAlerts).mockResolvedValue({ raised: 1 } as any)
    const res = await post()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'success', counts: { campaigns: 2 }, alerts: { raised: 1 } })
    expect(syncAmazonAds).toHaveBeenCalledTimes(1)
    expect(runChannelAlerts).toHaveBeenCalledWith(['rule'])
  })

  it('409 when the job is already running', async () => {
    vi.mocked(syncAmazonAds).mockRejectedValue(new ChannelJobBusyError('amazon_ads_sync' as any))
    const res = await post()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/already running/)
    expect(runChannelAlerts).not.toHaveBeenCalled()
  })

  it('409 telling the admin to connect when there is no connection', async () => {
    vi.mocked(syncAmazonAds).mockRejectedValue(new IntegrationNotConnectedError('x', 't1'))
    const res = await post()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Connect Amazon Ads first.' })
  })

  it('502 when the provider API fails with a 5xx', async () => {
    vi.mocked(syncAmazonAds).mockRejectedValue(Object.assign(new Error('upstream down'), { httpStatus: 502 }))
    expect((await post()).status).toBe(502)
  })
})
