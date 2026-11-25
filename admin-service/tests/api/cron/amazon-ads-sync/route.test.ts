import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), getClient: vi.fn(), withTransaction: vi.fn(), resolveRequestTenant: vi.fn() }))
vi.mock('@/lib/integrations/resolve', () => ({ IntegrationNotConnectedError: class IntegrationNotConnectedError extends Error {} }))
vi.mock('@/lib/channels/alerts-engine', () => ({ runChannelAlerts: vi.fn() }))
vi.mock('@/lib/amazon-ads/client', () => ({ adsAppReady: vi.fn(), adsEnvReady: vi.fn(), readAmazonAdsConfig: vi.fn() }))
vi.mock('@/lib/amazon-ads/sync', () => ({ syncAmazonAds: vi.fn() }))
vi.mock('@/lib/amazon-ads/alerts', () => ({ AMAZON_ADS_RULES: ['rule'] }))

import { GET } from '@admin/app/api/(internal)/cron/amazon-ads-sync/route'
import { IntegrationNotConnectedError } from '@/lib/integrations/resolve'
import { ChannelJobBusyError } from '@/lib/channels/sync-run'
import { runChannelAlerts } from '@/lib/channels/alerts-engine'
import { adsAppReady, adsEnvReady, readAmazonAdsConfig } from '@/lib/amazon-ads/client'
import { syncAmazonAds } from '@/lib/amazon-ads/sync'


const run = (auth?: string) => GET(new NextRequest('http://localhost/api/cron/amazon-ads-sync', { headers: auth ? { authorization: auth } : {} }))
const OK = 'Bearer test-cron-secret'

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  process.env.CRON_SECRET = 'test-cron-secret'
  vi.mocked(readAmazonAdsConfig).mockResolvedValue({ profile_id: '42' } as any)
  vi.mocked(adsAppReady).mockReturnValue(true)
  vi.mocked(adsEnvReady).mockReturnValue(true)
})

describe('GET /api/cron/amazon-ads-sync', () => {
  it('401 without the cron secret or with a wrong one, and runs nothing', async () => {
    expect((await run()).status).toBe(401)
    expect((await run('Bearer wrong')).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await run('Bearer undefined')).status).toBe(401)
    expect(syncAmazonAds).not.toHaveBeenCalled()
  })

  it('skips as not_connected when the platform app is set up but no profile is connected', async () => {
    vi.mocked(readAmazonAdsConfig).mockResolvedValue({} as any)
    const res = await run(OK)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: 'not_connected' })
    expect(syncAmazonAds).not.toHaveBeenCalled()
  })

  it('skips as not_configured when there is no profile and no platform app', async () => {
    vi.mocked(readAmazonAdsConfig).mockResolvedValue(null as any)
    vi.mocked(adsEnvReady).mockReturnValue(false)
    const res = await run(OK)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: 'not_configured' })
    expect(syncAmazonAds).not.toHaveBeenCalled()
  })

  it('skips as not_configured when the connected profile has no usable app', async () => {
    vi.mocked(adsAppReady).mockReturnValue(false)
    const res = await run(OK)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: 'not_configured' })
    expect(syncAmazonAds).not.toHaveBeenCalled()
  })

  it('skips as not_connected when the connection check throws', async () => {
    vi.mocked(readAmazonAdsConfig).mockRejectedValue(new Error('x'))
    expect(await (await run(OK)).json()).toEqual({ skipped: 'not_connected' })
    expect(syncAmazonAds).not.toHaveBeenCalled()
  })

  it('runs the job and returns its status, counts and the alerts it raised', async () => {
    vi.mocked(syncAmazonAds).mockResolvedValue({ status: 'success', counts: { rows: 3 }, errors: [] } as any)
    vi.mocked(runChannelAlerts).mockResolvedValue({ raised: 2 } as any)
    const res = await run(OK)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'success', counts: { rows: 3 }, errors: 0, alerts: { raised: 2 } })
    expect(syncAmazonAds).toHaveBeenCalledTimes(1)
    expect(runChannelAlerts).toHaveBeenCalledWith(['rule'])
  })

  it('skips as running when the job is already running', async () => {
    vi.mocked(syncAmazonAds).mockRejectedValue(new ChannelJobBusyError('amazon_ads_sync' as any))
    const res = await run(OK)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: 'running' })
  })

  it('skips as not_connected when the provider connection is gone mid-run', async () => {
    vi.mocked(syncAmazonAds).mockRejectedValue(new IntegrationNotConnectedError('x', 't1'))
    expect(await (await run(OK)).json()).toEqual({ skipped: 'not_connected' })
  })

  it('500 with the message when the provider API throws', async () => {
    vi.mocked(syncAmazonAds).mockRejectedValue(new Error('provider down'))
    const res = await run(OK)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'provider down' })
  })
})
