import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const lib = vi.hoisted(() => ({ updateAllTenantS3Usage: vi.fn() }))
vi.mock('@controller/lib/billing/s3-usage', () => lib)

import { GET } from '@controller/app/api/(internal)/cron/s3-usage/route'

const mock = lib.updateAllTenantS3Usage
const call = (auth: string | null = 'Bearer test-cron-secret') =>
  GET(new NextRequest('http://localhost/api/cron/s3-usage', { method: 'GET', headers: auth ? { authorization: auth } : {} }))

describe('GET /api/cron/s3-usage', () => {
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
    mock.mockResolvedValue({ tenants: 5 })
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, tenants: 5 })
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('reports a failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mock.mockRejectedValue(new Error('s3 down'))
    const res = await call()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Error: s3 down' })
  })

})
