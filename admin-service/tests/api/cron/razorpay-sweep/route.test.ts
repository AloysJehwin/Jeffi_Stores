import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), getClient: vi.fn(), withTransaction: vi.fn(), resolveRequestTenant: vi.fn() }))
vi.mock('@/lib/integrations/resolve', () => ({ IntegrationNotConnectedError: class IntegrationNotConnectedError extends Error {} }))
vi.mock('@/lib/channels/alerts-engine', () => ({ runChannelAlerts: vi.fn() }))
vi.mock('@/lib/payments/razorpay', () => ({ getRazorpayInstanceFor: vi.fn() }))
vi.mock('@/lib/payments/rzp-account', () => ({ razorpayAccountFor: vi.fn() }))
vi.mock('@/lib/payments/rzp-sweep', () => ({ sweepRazorpay: vi.fn() }))

import { GET } from '@admin/app/api/(internal)/cron/razorpay-sweep/route'
import { IntegrationNotConnectedError } from '@/lib/integrations/resolve'
import { ChannelJobBusyError } from '@/lib/channels/sync-run'
import { runChannelAlerts } from '@/lib/channels/alerts-engine'
import { getRazorpayInstanceFor } from '@/lib/payments/razorpay'
import { razorpayAccountFor } from '@/lib/payments/rzp-account'
import { sweepRazorpay } from '@/lib/payments/rzp-sweep'


const run = (auth?: string) => GET(new NextRequest('http://localhost/api/cron/razorpay-sweep', { headers: auth ? { authorization: auth } : {} }))
const OK = 'Bearer test-cron-secret'

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  process.env.CRON_SECRET = 'test-cron-secret'
  vi.mocked(razorpayAccountFor).mockResolvedValue({ tenantId: 't1' } as any)
  vi.mocked(getRazorpayInstanceFor).mockResolvedValue({} as any)
})

describe('GET /api/cron/razorpay-sweep', () => {
  it('401 without the cron secret or with a wrong one, and runs nothing', async () => {
    expect((await run()).status).toBe(401)
    expect((await run('Bearer wrong')).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await run('Bearer undefined')).status).toBe(401)
    expect(sweepRazorpay).not.toHaveBeenCalled()
  })

  it('skips as not_connected when the connection check throws', async () => {
    vi.mocked(getRazorpayInstanceFor).mockRejectedValue(new Error('no keys'))
    expect(await (await run(OK)).json()).toEqual({ skipped: 'not_connected' })
    expect(sweepRazorpay).not.toHaveBeenCalled()
  })

  it('sweeps stuck Razorpay payments for the store account and returns the run summary', async () => {
    vi.mocked(sweepRazorpay).mockResolvedValue({ status: 'partial', counts: { settled: 2 }, errors: [] } as any)
    const res = await run(OK)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'partial', counts: { settled: 2 }, errors: 0 })
    expect(getRazorpayInstanceFor).toHaveBeenCalledWith('t1')
    expect(sweepRazorpay).toHaveBeenCalledTimes(1)
  })

  it('uses the platform keys (no tenant id) when the store has no own account id', async () => {
    vi.mocked(razorpayAccountFor).mockResolvedValue({ tenantId: null } as any)
    vi.mocked(sweepRazorpay).mockResolvedValue({ status: 'success', counts: {}, errors: [] } as any)
    await run(OK)
    expect(getRazorpayInstanceFor).toHaveBeenCalledWith(undefined)
  })

  it('skips as running when the job is already running', async () => {
    vi.mocked(sweepRazorpay).mockRejectedValue(new ChannelJobBusyError('razorpay_sweep' as any))
    const res = await run(OK)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: 'running' })
  })

  it('skips as not_connected when the provider connection is gone mid-run', async () => {
    vi.mocked(sweepRazorpay).mockRejectedValue(new IntegrationNotConnectedError('x', 't1'))
    expect(await (await run(OK)).json()).toEqual({ skipped: 'not_connected' })
  })

  it('500 with the message when the provider API throws', async () => {
    vi.mocked(sweepRazorpay).mockRejectedValue(new Error('provider down'))
    const res = await run(OK)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'provider down' })
  })
})
