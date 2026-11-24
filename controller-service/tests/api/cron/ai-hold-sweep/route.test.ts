import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const lib = vi.hoisted(() => ({ sweepStaleHolds: vi.fn() }))
vi.mock('@/lib/ai/paid-generation', () => lib)
const alert = vi.hoisted(() => ({ sendPlatformAlert: vi.fn(async () => {}) }))
vi.mock('@controller/lib/provisioning/alerts', () => alert)

import { POST } from '@controller/app/api/(internal)/cron/ai-hold-sweep/route'

const mock = lib.sweepStaleHolds
const call = (auth: string | null = 'Bearer test-cron-secret') =>
  POST(new NextRequest('http://localhost/api/cron/ai-hold-sweep', { method: 'POST', headers: auth ? { authorization: auth } : {} }))

describe('POST /api/cron/ai-hold-sweep', () => {
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
    mock.mockResolvedValue({ settled: [], failed: [] })
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ settled: [], failed: [] })
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('reports a failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mock.mockRejectedValue(new Error('db down'))
    const res = await call()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'db down' })
  })

  it('settles stuck holds, warns, and answers 200', async () => {
    mock.mockResolvedValue({ settled: [{ walletRef: 'w1' }], failed: [] })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await call()
    expect(res.status).toBe(200)
    expect(warn).toHaveBeenCalled()
    expect(alert.sendPlatformAlert).not.toHaveBeenCalled()
  })

  it('answers 500 and alerts once for a fresh unsettled hold (production)', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    mock.mockResolvedValue({ settled: [], failed: [{ walletRef: 'w1', tenantId: 't1', capInr: 50, error: 'boom', firstFailure: true }] })
    const res = await call()
    expect(res.status).toBe(500)
    expect(alert.sendPlatformAlert).toHaveBeenCalledTimes(1)
    expect(alert.sendPlatformAlert.mock.calls[0][0]).toContain('not settled')
  })

  it('does not mail outside production and skips repeat failures', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mock.mockResolvedValue({ settled: [], failed: [{ walletRef: 'w1', tenantId: 't1', capInr: 50, error: 'boom', firstFailure: true }, { walletRef: 'w2', tenantId: 't1', capInr: 5, error: 'x', firstFailure: false }] })
    expect((await call()).status).toBe(500)
    expect(alert.sendPlatformAlert).not.toHaveBeenCalled()
  })
})
