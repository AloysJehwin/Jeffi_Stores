import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const lib = vi.hoisted(() => ({ activateOnlineWhatsAppNumbers: vi.fn() }))
vi.mock('@controller/lib/messaging/tenant-numbers', () => lib)

import { POST } from '@controller/app/api/(internal)/cron/messaging-numbers-online/route'

const mock = lib.activateOnlineWhatsAppNumbers
const call = (auth: string | null = 'Bearer test-cron-secret') =>
  POST(new NextRequest('http://localhost/api/cron/messaging-numbers-online', { method: 'POST', headers: auth ? { authorization: auth } : {} }))

describe('POST /api/cron/messaging-numbers-online', () => {
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
    mock.mockResolvedValue({ activated: 1 })
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ activated: 1 })
    expect(mock).toHaveBeenCalledTimes(1)
  })

})
