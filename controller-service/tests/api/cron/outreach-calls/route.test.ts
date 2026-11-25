import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const run = vi.hoisted(() => vi.fn())
vi.mock('@controller/lib/outreach/worker', () => ({ runOutreachWorker: run }))

import { GET } from '@controller/app/api/(internal)/cron/outreach-calls/route'

const call = (auth: string | null = 'Bearer test-cron-secret') =>
  GET(new NextRequest('http://localhost/api/cron/outreach-calls', { headers: auth ? { authorization: auth } : {} }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', 'test-cron-secret')
})
afterEach(() => vi.unstubAllEnvs())

describe('GET /api/cron/outreach-calls', () => {
  it('401s a missing or wrong secret without dialling', async () => {
    expect((await call(null)).status).toBe(401)
    expect((await call('Bearer nope')).status).toBe(401)
    expect(run).not.toHaveBeenCalled()
  })

  it('200s with the run summary', async () => {
    const summary = { swept: 0, testMode: false, programs: [{ program: 'showcase-offer', placed: 2, failed: 0 }] }
    run.mockResolvedValue(summary)
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(summary)
  })

  it('500s when the run throws', async () => {
    run.mockRejectedValue(new Error('boom'))
    const res = await call()
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('boom')
  })
})
