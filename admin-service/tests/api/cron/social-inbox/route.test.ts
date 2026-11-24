import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), getClient: vi.fn(), withTransaction: vi.fn(), resolveRequestTenant: vi.fn() }))
vi.mock('@/lib/integrations/resolve', () => ({ IntegrationNotConnectedError: class IntegrationNotConnectedError extends Error {} }))
vi.mock('@/lib/channels/alerts-engine', () => ({ runChannelAlerts: vi.fn() }))
vi.mock('@/lib/social/jobs', () => ({ hasSocialAccounts: vi.fn(), syncSocialInbox: vi.fn() }))

import { GET } from '@admin/app/api/(internal)/cron/social-inbox/route'
import { IntegrationNotConnectedError } from '@/lib/integrations/resolve'
import { ChannelJobBusyError } from '@/lib/channels/sync-run'
import { runChannelAlerts } from '@/lib/channels/alerts-engine'
import { hasSocialAccounts, syncSocialInbox } from '@/lib/social/jobs'


const run = (auth?: string) => GET(new NextRequest('http://localhost/api/cron/social-inbox', { headers: auth ? { authorization: auth } : {} }))
const OK = 'Bearer test-cron-secret'

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  process.env.CRON_SECRET = 'test-cron-secret'
  vi.mocked(hasSocialAccounts).mockResolvedValue(true)
})

describe('GET /api/cron/social-inbox', () => {
  it('401 without the cron secret or with a wrong one, and runs nothing', async () => {
    expect((await run()).status).toBe(401)
    expect((await run('Bearer wrong')).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await run('Bearer undefined')).status).toBe(401)
    expect(syncSocialInbox).not.toHaveBeenCalled()
  })

  it('skips as not_connected when no social account is connected', async () => {
    vi.mocked(hasSocialAccounts).mockResolvedValue(false)
    const res = await run(OK)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: 'not_connected' })
    expect(syncSocialInbox).not.toHaveBeenCalled()
  })

  it('skips as not_connected when the connection check throws', async () => {
    vi.mocked(hasSocialAccounts).mockRejectedValue(new Error('x'))
    expect(await (await run(OK)).json()).toEqual({ skipped: 'not_connected' })
    expect(syncSocialInbox).not.toHaveBeenCalled()
  })

  it('syncs the social inbox and returns the job result', async () => {
    vi.mocked(syncSocialInbox).mockResolvedValue({ status: 'success', counts: { items: 6 } } as any)
    const res = await run(OK)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'success', counts: { items: 6 } })
    expect(syncSocialInbox).toHaveBeenCalledTimes(1)
  })

  it('skips as running when the job is already running', async () => {
    vi.mocked(syncSocialInbox).mockRejectedValue(new ChannelJobBusyError('social_sync' as any))
    const res = await run(OK)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: 'running' })
  })

  it('skips as not_connected when the provider connection is gone mid-run', async () => {
    vi.mocked(syncSocialInbox).mockRejectedValue(new IntegrationNotConnectedError('x', 't1'))
    expect(await (await run(OK)).json()).toEqual({ skipped: 'not_connected' })
  })

  it('500 with the message when the provider API throws', async () => {
    vi.mocked(syncSocialInbox).mockRejectedValue(new Error('provider down'))
    const res = await run(OK)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'provider down' })
  })
})
