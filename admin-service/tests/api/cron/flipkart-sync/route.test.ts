import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), getClient: vi.fn(), withTransaction: vi.fn(), resolveRequestTenant: vi.fn() }))
vi.mock('@/lib/integrations/resolve', () => ({ IntegrationNotConnectedError: class IntegrationNotConnectedError extends Error {} }))
vi.mock('@/lib/channels/alerts-engine', () => ({ runChannelAlerts: vi.fn() }))
vi.mock('@/lib/marketplace-ads/alerts', () => ({ adsRuleSet: vi.fn() }))
vi.mock('@/lib/marketplace/sync', () => ({ marketplaceSyncSkip: vi.fn(), runMarketplaceSync: vi.fn() }))

import { GET } from '@admin/app/api/(internal)/cron/flipkart-sync/route'
import { IntegrationNotConnectedError } from '@/lib/integrations/resolve'
import { ChannelJobBusyError } from '@/lib/channels/sync-run'
import { runChannelAlerts } from '@/lib/channels/alerts-engine'
import { adsRuleSet } from '@/lib/marketplace-ads/alerts'
import { marketplaceSyncSkip, runMarketplaceSync } from '@/lib/marketplace/sync'


const run = (auth?: string) => GET(new NextRequest('http://localhost/api/cron/flipkart-sync', { headers: auth ? { authorization: auth } : {} }))
const OK = 'Bearer test-cron-secret'

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  process.env.CRON_SECRET = 'test-cron-secret'
  vi.mocked(adsRuleSet).mockReturnValue(['flipkart-rule'] as any)
  vi.mocked(marketplaceSyncSkip).mockResolvedValue(null as any)
  vi.mocked(runChannelAlerts).mockResolvedValue({ raised: 1 } as any)
})

describe('GET /api/cron/flipkart-sync', () => {
  it('401 without the cron secret or with a wrong one, and runs nothing', async () => {
    expect((await run()).status).toBe(401)
    expect((await run('Bearer wrong')).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await run('Bearer undefined')).status).toBe(401)
    expect(runMarketplaceSync).not.toHaveBeenCalled()
  })

  it('syncs orders, listings and stock for the marketplace and returns the ads alerts', async () => {
    vi.mocked(runMarketplaceSync).mockResolvedValue({ status: 'success', counts: { orders: 5 } } as any)
    const res = await run(OK)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'success', counts: { orders: 5 }, adsAlerts: { raised: 1 } })
    expect(runMarketplaceSync).toHaveBeenCalledWith('flipkart')
    expect(adsRuleSet).toHaveBeenCalledWith('flipkart_ads')
    expect(runChannelAlerts).toHaveBeenCalledWith(['flipkart-rule'])
  })

  it('still runs the ads alerts but not the sync when the marketplace is not ready', async () => {
    vi.mocked(marketplaceSyncSkip).mockResolvedValue('not_connected' as any)
    const res = await run(OK)
    expect(await res.json()).toEqual({ skipped: 'not_connected', adsAlerts: { raised: 1 } })
    expect(marketplaceSyncSkip).toHaveBeenCalledWith('flipkart')
    expect(runMarketplaceSync).not.toHaveBeenCalled()
  })

  it('skips as running when the job is already running', async () => {
    vi.mocked(runMarketplaceSync).mockRejectedValue(new ChannelJobBusyError('marketplace_sync' as any))
    const res = await run(OK)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: 'running' })
  })

  it('skips as not_connected when the provider connection is gone mid-run', async () => {
    vi.mocked(runMarketplaceSync).mockRejectedValue(new IntegrationNotConnectedError('x', 't1'))
    expect(await (await run(OK)).json()).toEqual({ skipped: 'not_connected' })
  })

  it('500 with the message when the provider API throws', async () => {
    vi.mocked(runMarketplaceSync).mockRejectedValue(new Error('provider down'))
    const res = await run(OK)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'provider down' })
  })
})
