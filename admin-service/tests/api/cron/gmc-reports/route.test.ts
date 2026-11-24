import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), getClient: vi.fn(), withTransaction: vi.fn(), resolveRequestTenant: vi.fn() }))
vi.mock('@/lib/integrations/resolve', () => ({ IntegrationNotConnectedError: class IntegrationNotConnectedError extends Error {} }))
vi.mock('@/lib/channels/alerts-engine', () => ({ runChannelAlerts: vi.fn() }))
vi.mock('@/lib/merchant/client', () => ({ merchantConfigured: vi.fn() }))
vi.mock('@/lib/merchant/reports', () => ({ refreshMerchantReports: vi.fn() }))
vi.mock('@/lib/merchant/alerts', () => ({ GMC_RULES: ['rule'] }))

import { GET } from '@admin/app/api/(internal)/cron/gmc-reports/route'
import { IntegrationNotConnectedError } from '@/lib/integrations/resolve'
import { ChannelJobBusyError } from '@/lib/channels/sync-run'
import { runChannelAlerts } from '@/lib/channels/alerts-engine'
import { merchantConfigured } from '@/lib/merchant/client'
import { refreshMerchantReports } from '@/lib/merchant/reports'


const run = (auth?: string) => GET(new NextRequest('http://localhost/api/cron/gmc-reports', { headers: auth ? { authorization: auth } : {} }))
const OK = 'Bearer test-cron-secret'

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  process.env.CRON_SECRET = 'test-cron-secret'
  vi.mocked(merchantConfigured).mockResolvedValue(true)
})

describe('GET /api/cron/gmc-reports', () => {
  it('401 without the cron secret or with a wrong one, and runs nothing', async () => {
    expect((await run()).status).toBe(401)
    expect((await run('Bearer wrong')).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await run('Bearer undefined')).status).toBe(401)
    expect(refreshMerchantReports).not.toHaveBeenCalled()
  })

  it('skips as not_connected when Merchant Center is not connected', async () => {
    vi.mocked(merchantConfigured).mockResolvedValue(false)
    const res = await run(OK)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: 'not_connected' })
    expect(refreshMerchantReports).not.toHaveBeenCalled()
  })

  it('runs the job and returns its status, counts and the alerts it raised', async () => {
    vi.mocked(refreshMerchantReports).mockResolvedValue({ status: 'success', counts: { rows: 3 }, errors: [] } as any)
    vi.mocked(runChannelAlerts).mockResolvedValue({ raised: 2 } as any)
    const res = await run(OK)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'success', counts: { rows: 3 }, errors: 0, alerts: { raised: 2 } })
    expect(refreshMerchantReports).toHaveBeenCalledTimes(1)
    expect(runChannelAlerts).toHaveBeenCalledWith(['rule'])
  })

  it('skips as running when the job is already running', async () => {
    vi.mocked(refreshMerchantReports).mockRejectedValue(new ChannelJobBusyError('gmc_sync' as any))
    const res = await run(OK)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: 'running' })
  })

  it('skips as not_connected when the provider connection is gone mid-run', async () => {
    vi.mocked(refreshMerchantReports).mockRejectedValue(new IntegrationNotConnectedError('x', 't1'))
    expect(await (await run(OK)).json()).toEqual({ skipped: 'not_connected' })
  })

  it('500 with the message when the provider API throws', async () => {
    vi.mocked(refreshMerchantReports).mockRejectedValue(new Error('provider down'))
    const res = await run(OK)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'provider down' })
  })
})
