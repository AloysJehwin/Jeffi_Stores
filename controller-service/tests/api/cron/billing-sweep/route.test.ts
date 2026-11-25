import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const lib = vi.hoisted(() => ({ runBillingSweep: vi.fn() }))
vi.mock('@controller/lib/billing/sweep', () => lib)

import { POST } from '@controller/app/api/(internal)/cron/billing-sweep/route'

const mock = lib.runBillingSweep
const call = (auth: string | null = 'Bearer test-cron-secret') =>
  POST(new NextRequest('http://localhost/api/cron/billing-sweep', { method: 'POST', headers: auth ? { authorization: auth } : {} }))

describe('POST /api/cron/billing-sweep', () => {
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
    mock.mockResolvedValue({ failed: [], done: 3 })
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ failed: [], done: 3 })
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('reports a failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mock.mockResolvedValue({ failed: ['trial'], done: 1 })
    const res = await call()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ failed: ['trial'], done: 1 })
  })

})
