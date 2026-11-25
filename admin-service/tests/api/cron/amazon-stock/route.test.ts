import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), getClient: vi.fn(), withTransaction: vi.fn(), resolveRequestTenant: vi.fn() }))
vi.mock('@/lib/integrations/resolve', () => ({ IntegrationNotConnectedError: class IntegrationNotConnectedError extends Error {} }))
vi.mock('@/lib/channels/alerts-engine', () => ({ runChannelAlerts: vi.fn() }))
vi.mock('@/lib/amazon/client', () => ({ amazonConfigured: vi.fn() }))
vi.mock('@/lib/amazon/alerts', () => ({ AMAZON_RULES: ['rule'] }))
vi.mock('@/lib/amazon/stock', () => ({ pushAmazonStock: vi.fn(), stockSettings: vi.fn() }))

import { GET } from '@admin/app/api/(internal)/cron/amazon-stock/route'
import { IntegrationNotConnectedError } from '@/lib/integrations/resolve'
import { ChannelJobBusyError } from '@/lib/channels/sync-run'
import { runChannelAlerts } from '@/lib/channels/alerts-engine'
import { amazonConfigured } from '@/lib/amazon/client'
import { pushAmazonStock, stockSettings } from '@/lib/amazon/stock'


const run = (auth?: string) => GET(new NextRequest('http://localhost/api/cron/amazon-stock', { headers: auth ? { authorization: auth } : {} }))
const OK = 'Bearer test-cron-secret'

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  process.env.CRON_SECRET = 'test-cron-secret'
  vi.mocked(amazonConfigured).mockResolvedValue(true)
  vi.mocked(stockSettings).mockResolvedValue({ enabled: true } as any)
})

describe('GET /api/cron/amazon-stock', () => {
  it('401 without the cron secret or with a wrong one, and runs nothing', async () => {
    expect((await run()).status).toBe(401)
    expect((await run('Bearer wrong')).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await run('Bearer undefined')).status).toBe(401)
    expect(pushAmazonStock).not.toHaveBeenCalled()
  })

  it('skips as not_connected when Amazon is not connected', async () => {
    vi.mocked(amazonConfigured).mockResolvedValue(false)
    const res = await run(OK)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: 'not_connected' })
    expect(pushAmazonStock).not.toHaveBeenCalled()
  })

  it('skips as disabled when stock sync is switched off', async () => {
    vi.mocked(stockSettings).mockResolvedValue({ enabled: false } as any)
    const res = await run(OK)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: 'disabled' })
    expect(pushAmazonStock).not.toHaveBeenCalled()
  })

  it('skips as not_connected when the connection check throws', async () => {
    vi.mocked(amazonConfigured).mockRejectedValue(new Error('creds unreadable'))
    expect(await (await run(OK)).json()).toEqual({ skipped: 'not_connected' })
    expect(pushAmazonStock).not.toHaveBeenCalled()
  })

  it('runs the job and returns its status, counts and the alerts it raised', async () => {
    vi.mocked(pushAmazonStock).mockResolvedValue({ status: 'success', counts: { rows: 3 }, errors: [] } as any)
    vi.mocked(runChannelAlerts).mockResolvedValue({ raised: 2 } as any)
    const res = await run(OK)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'success', counts: { rows: 3 }, errors: 0, alerts: { raised: 2 } })
    expect(pushAmazonStock).toHaveBeenCalledTimes(1)
    expect(runChannelAlerts).toHaveBeenCalledWith(['rule'])
  })

  it('skips as running when the job is already running', async () => {
    vi.mocked(pushAmazonStock).mockRejectedValue(new ChannelJobBusyError('amazon_sync' as any))
    const res = await run(OK)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: 'running' })
  })

  it('skips as not_connected when the provider connection is gone mid-run', async () => {
    vi.mocked(pushAmazonStock).mockRejectedValue(new IntegrationNotConnectedError('x', 't1'))
    expect(await (await run(OK)).json()).toEqual({ skipped: 'not_connected' })
  })

  it('500 with the message when the provider API throws', async () => {
    vi.mocked(pushAmazonStock).mockRejectedValue(new Error('provider down'))
    const res = await run(OK)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'provider down' })
  })
})
