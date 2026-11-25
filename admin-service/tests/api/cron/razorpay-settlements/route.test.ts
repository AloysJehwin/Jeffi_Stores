import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), getClient: vi.fn(), withTransaction: vi.fn(), resolveRequestTenant: vi.fn() }))
vi.mock('@/lib/integrations/resolve', () => ({ IntegrationNotConnectedError: class IntegrationNotConnectedError extends Error {} }))
vi.mock('@/lib/channels/alerts-engine', () => ({ runChannelAlerts: vi.fn() }))
vi.mock('@/lib/payments/rzp-account', () => ({ razorpayAccountFor: vi.fn() }))
vi.mock('@/lib/payments/rzp-settlements', () => ({ syncRazorpaySettlements: vi.fn() }))

import { GET } from '@admin/app/api/(internal)/cron/razorpay-settlements/route'
import { IntegrationNotConnectedError } from '@/lib/integrations/resolve'
import { ChannelJobBusyError } from '@/lib/channels/sync-run'
import { runChannelAlerts } from '@/lib/channels/alerts-engine'
import { razorpayAccountFor } from '@/lib/payments/rzp-account'
import { syncRazorpaySettlements } from '@/lib/payments/rzp-settlements'


const run = (auth?: string) => GET(new NextRequest('http://localhost/api/cron/razorpay-settlements', { headers: auth ? { authorization: auth } : {} }))
const OK = 'Bearer test-cron-secret'

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  process.env.CRON_SECRET = 'test-cron-secret'
  vi.mocked(razorpayAccountFor).mockResolvedValue({ kind: 'own' } as any)
})

describe('GET /api/cron/razorpay-settlements', () => {
  it('401 without the cron secret or with a wrong one, and runs nothing', async () => {
    expect((await run()).status).toBe(401)
    expect((await run('Bearer wrong')).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await run('Bearer undefined')).status).toBe(401)
    expect(syncRazorpaySettlements).not.toHaveBeenCalled()
  })

  it('skips as route_store when the store settles through the platform Route account', async () => {
    vi.mocked(razorpayAccountFor).mockResolvedValue({ kind: 'route' } as any)
    const res = await run(OK)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: 'route_store' })
    expect(syncRazorpaySettlements).not.toHaveBeenCalled()
  })

  it('skips as not_connected when the connection check throws', async () => {
    vi.mocked(razorpayAccountFor).mockRejectedValue(new Error('x'))
    expect(await (await run(OK)).json()).toEqual({ skipped: 'not_connected' })
    expect(syncRazorpaySettlements).not.toHaveBeenCalled()
  })

  it('syncs the store settlements and returns the run summary', async () => {
    vi.mocked(syncRazorpaySettlements).mockResolvedValue({ status: 'success', counts: { settlements: 4 }, errors: [{ step: 's', message: 'm' }] } as any)
    const res = await run(OK)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'success', counts: { settlements: 4 }, errors: 1 })
    expect(syncRazorpaySettlements).toHaveBeenCalledTimes(1)
  })

  it('skips as running when the job is already running', async () => {
    vi.mocked(syncRazorpaySettlements).mockRejectedValue(new ChannelJobBusyError('razorpay_settlements' as any))
    const res = await run(OK)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: 'running' })
  })

  it('skips as not_connected when the provider connection is gone mid-run', async () => {
    vi.mocked(syncRazorpaySettlements).mockRejectedValue(new IntegrationNotConnectedError('x', 't1'))
    expect(await (await run(OK)).json()).toEqual({ skipped: 'not_connected' })
  })

  it('500 with the message when the provider API throws', async () => {
    vi.mocked(syncRazorpaySettlements).mockRejectedValue(new Error('provider down'))
    const res = await run(OK)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'provider down' })
  })
})
