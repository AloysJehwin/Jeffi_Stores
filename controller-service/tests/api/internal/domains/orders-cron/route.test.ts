import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const lib = vi.hoisted(() => ({ runDomainOrdersCron: vi.fn() }))
vi.mock('@controller/lib/domains/orders', () => lib)

import { POST } from '@controller/app/api/(internal)/internal/domains/orders-cron/route'

const mock = lib.runDomainOrdersCron
const call = (auth: string | null = 'Bearer test-cron-secret') =>
  POST(new NextRequest('http://localhost/api/internal/domains/orders-cron', { method: 'POST', headers: auth ? { authorization: auth } : {} }))

describe('POST /api/internal/domains/orders-cron', () => {
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
    mock.mockResolvedValue({ processed: 1, errors: [] })
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, processed: 1, errors: [] })
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('reports a failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mock.mockResolvedValue({ processed: 0, errors: ['reg failed'] })
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, processed: 0, errors: ['reg failed'] })
  })

})
