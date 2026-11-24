import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const lib = vi.hoisted(() => ({ reconcileCapturedTransactions: vi.fn() }))
vi.mock('@/lib/payments/route-settlement', () => lib)

import { GET } from '@controller/app/api/(internal)/cron/reconcile-settlements/route'

const mock = lib.reconcileCapturedTransactions
const call = (auth: string | null = 'Bearer test-cron-secret') =>
  GET(new NextRequest('http://localhost/api/cron/reconcile-settlements', { method: 'GET', headers: auth ? { authorization: auth } : {} }))

describe('GET /api/cron/reconcile-settlements', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('CRON_SECRET', 'test-cron-secret')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('rejects a missing secret', async () => {
    expect((await call(null)).status).toBe(401)
    expect(mock).not.toHaveBeenCalled()
  })

  it('rejects a wrong secret', async () => {
    expect((await call('Bearer nope')).status).toBe(401)
    expect(mock).not.toHaveBeenCalled()
  })

  it('rejects everything when CRON_SECRET is unset', async () => {
    vi.stubEnv('CRON_SECRET', '')
    expect((await call('Bearer ')).status).toBe(401)
  })

  it('runs the job with the right secret', async () => {
    mock.mockResolvedValue({ settled: 2 })
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ settled: 2 })
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('asks for rows older than two minutes, capped at 200', async () => {
    mock.mockResolvedValue({ settled: 0 })
    await call()
    expect(mock).toHaveBeenCalledWith({ olderThanMinutes: 2, limit: 200 })
  })
})
