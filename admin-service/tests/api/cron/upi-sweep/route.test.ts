import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), getClient: vi.fn(), withTransaction: vi.fn(), resolveRequestTenant: vi.fn() }))
vi.mock('@/lib/integrations/resolve', () => ({ IntegrationNotConnectedError: class IntegrationNotConnectedError extends Error {} }))
vi.mock('@/lib/channels/alerts-engine', () => ({ runChannelAlerts: vi.fn() }))
vi.mock('@/lib/payments/upi/settle', () => ({ sweepUpiIntents: vi.fn() }))

import { GET } from '@admin/app/api/(internal)/cron/upi-sweep/route'
import { IntegrationNotConnectedError } from '@/lib/integrations/resolve'
import { ChannelJobBusyError } from '@/lib/channels/sync-run'
import { runChannelAlerts } from '@/lib/channels/alerts-engine'
import { resolveRequestTenant } from '@/lib/shared/db'
import { sweepUpiIntents } from '@/lib/payments/upi/settle'


const run = (auth?: string) => GET(new NextRequest('http://localhost/api/cron/upi-sweep', { headers: auth ? { authorization: auth } : {} }))
const OK = 'Bearer test-cron-secret'

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  process.env.CRON_SECRET = 'test-cron-secret'
})

describe('GET /api/cron/upi-sweep', () => {
  it('401 without the cron secret or with a wrong one, and runs nothing', async () => {
    expect((await run()).status).toBe(401)
    expect((await run('Bearer wrong')).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await run('Bearer undefined')).status).toBe(401)
    expect(sweepUpiIntents).not.toHaveBeenCalled()
  })

  it('settles the lost UPI intents for the store the request resolves to', async () => {
    vi.mocked(resolveRequestTenant).mockResolvedValue({ tenantId: 't1', slug: 'acme', extra: 1 } as any)
    vi.mocked(sweepUpiIntents).mockResolvedValue({ processed: 3 } as any)
    const res = await run(OK)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ processed: 3 })
    expect(sweepUpiIntents).toHaveBeenCalledWith({ store: { tenantId: 't1', slug: 'acme' } })
  })

  it('runs for the platform (no store) when no tenant resolves', async () => {
    vi.mocked(resolveRequestTenant).mockResolvedValue(null as any)
    vi.mocked(sweepUpiIntents).mockResolvedValue({ processed: 0 } as any)
    await run(OK)
    expect(sweepUpiIntents).toHaveBeenCalledWith({ store: null })
  })

  it('skips as running when the job is already running', async () => {
    vi.mocked(sweepUpiIntents).mockRejectedValue(new ChannelJobBusyError('payments' as any))
    const res = await run(OK)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: 'running' })
  })

  it('skips as not_connected when the provider connection is gone mid-run', async () => {
    vi.mocked(sweepUpiIntents).mockRejectedValue(new IntegrationNotConnectedError('x', 't1'))
    expect(await (await run(OK)).json()).toEqual({ skipped: 'not_connected' })
  })

  it('500 with the message when the provider API throws', async () => {
    vi.mocked(sweepUpiIntents).mockRejectedValue(new Error('provider down'))
    const res = await run(OK)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'provider down' })
  })
})
