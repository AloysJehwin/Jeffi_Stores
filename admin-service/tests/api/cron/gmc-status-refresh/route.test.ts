import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), getClient: vi.fn(), withTransaction: vi.fn(), resolveRequestTenant: vi.fn() }))
vi.mock('@/lib/integrations/resolve', () => ({ IntegrationNotConnectedError: class IntegrationNotConnectedError extends Error {} }))
vi.mock('@/lib/channels/alerts-engine', () => ({ runChannelAlerts: vi.fn() }))
vi.mock('@/lib/merchant/client', () => ({ merchantConfigured: vi.fn() }))
vi.mock('@/lib/merchant/gmc-status', () => ({ refreshGmcStatusSnapshot: vi.fn() }))
vi.mock('@/lib/merchant/alerts', () => ({ GMC_RULES: ['rule'] }))

import { GET } from '@admin/app/api/(internal)/cron/gmc-status-refresh/route'
import { IntegrationNotConnectedError } from '@/lib/integrations/resolve'
import { ChannelJobBusyError } from '@/lib/channels/sync-run'
import { runChannelAlerts } from '@/lib/channels/alerts-engine'
import { merchantConfigured } from '@/lib/merchant/client'
import { refreshGmcStatusSnapshot } from '@/lib/merchant/gmc-status'


const run = (auth?: string) => GET(new NextRequest('http://localhost/api/cron/gmc-status-refresh', { headers: auth ? { authorization: auth } : {} }))
const OK = 'Bearer test-cron-secret'

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  process.env.CRON_SECRET = 'test-cron-secret'
  vi.mocked(merchantConfigured).mockResolvedValue(true)
})

describe('GET /api/cron/gmc-status-refresh', () => {
  it('401 without the cron secret or with a wrong one, and runs nothing', async () => {
    expect((await run()).status).toBe(401)
    expect((await run('Bearer wrong')).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await run('Bearer undefined')).status).toBe(401)
    expect(refreshGmcStatusSnapshot).not.toHaveBeenCalled()
  })

  it('skips as not_connected when Merchant Center is not connected', async () => {
    vi.mocked(merchantConfigured).mockResolvedValue(false)
    const res = await run(OK)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: 'not_connected' })
    expect(refreshGmcStatusSnapshot).not.toHaveBeenCalled()
  })

  it('refreshes the product status snapshot and returns the total with the alerts', async () => {
    vi.mocked(refreshGmcStatusSnapshot).mockResolvedValue({ total: 9 } as any)
    vi.mocked(runChannelAlerts).mockResolvedValue({ raised: 0 } as any)
    expect(await (await run(OK)).json()).toEqual({ status: 'success', total: 9, alerts: { raised: 0 } })
    expect(runChannelAlerts).toHaveBeenCalledWith(['rule'])
  })

  it('skips as running when another refresh holds the lock', async () => {
    vi.mocked(refreshGmcStatusSnapshot).mockResolvedValue({ locked: true } as any)
    expect(await (await run(OK)).json()).toEqual({ skipped: 'running' })
    expect(runChannelAlerts).not.toHaveBeenCalled()
  })

  it('skips as running when the job is already running', async () => {
    vi.mocked(refreshGmcStatusSnapshot).mockRejectedValue(new ChannelJobBusyError('gmc_sync' as any))
    const res = await run(OK)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: 'running' })
  })

  it('skips as not_connected when the provider connection is gone mid-run', async () => {
    vi.mocked(refreshGmcStatusSnapshot).mockRejectedValue(new IntegrationNotConnectedError('x', 't1'))
    expect(await (await run(OK)).json()).toEqual({ skipped: 'not_connected' })
  })

  it('500 with the message when the provider API throws', async () => {
    vi.mocked(refreshGmcStatusSnapshot).mockRejectedValue(new Error('provider down'))
    const res = await run(OK)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'provider down' })
  })
})
