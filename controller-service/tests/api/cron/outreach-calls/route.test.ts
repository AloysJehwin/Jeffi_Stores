import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({ run: vi.fn(), agent: vi.fn(), jobs: vi.fn() }))
const run = h.run
vi.mock('@controller/lib/outreach/worker', () => ({ runOutreachWorker: h.run }))
vi.mock('@controller/lib/outreach/agent/runtime', () => ({ runDueAgentTasks: h.agent, runDueJobs: h.jobs }))

import { GET } from '@controller/app/api/(internal)/cron/outreach-calls/route'

const call = (auth: string | null = 'Bearer test-cron-secret') =>
  GET(new NextRequest('http://localhost/api/cron/outreach-calls', { headers: auth ? { authorization: auth } : {} }))

beforeEach(() => {
  vi.clearAllMocks()
  h.agent.mockResolvedValue({ claimed: 0, ran: 0, rescheduled: 0, failed: 0, cancelled: 0 })
  h.jobs.mockResolvedValue({ claimed: 0, started: 0, deferred: 0, cancelled: 0, failed: 0 })
  vi.stubEnv('CRON_SECRET', 'test-cron-secret')
})
afterEach(() => vi.unstubAllEnvs())

describe('GET /api/cron/outreach-calls', () => {
  it('401s a missing or wrong secret without dialling', async () => {
    expect((await call(null)).status).toBe(401)
    expect((await call('Bearer nope')).status).toBe(401)
    expect(run).not.toHaveBeenCalled()
    expect(h.agent).not.toHaveBeenCalled()
  })

  it('200s with the dialler summary and the agent result', async () => {
    const summary = { swept: 0, testMode: false, programs: [{ program: 'showcase-offer', placed: 2, failed: 0 }] }
    const agent = { claimed: 2, ran: 1, rescheduled: 1, failed: 0, cancelled: 0 }
    run.mockResolvedValue(summary)
    h.agent.mockResolvedValue(agent)
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ...summary, jobs: { claimed: 0, started: 0, deferred: 0, cancelled: 0, failed: 0 }, agent })
  })

  it('500s when the dialler throws, but still runs the agent tasks', async () => {
    run.mockRejectedValue(new Error('boom'))
    const res = await call()
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('boom')
    expect(body.agent).toMatchObject({ claimed: 0 })
    expect(h.agent).toHaveBeenCalled()
  })

  it('500s when the agent tasks throw, keeping the dialler summary', async () => {
    const summary = { swept: 1, programs: [] }
    run.mockResolvedValue(summary)
    h.agent.mockRejectedValue(new Error('agent boom'))
    const res = await call()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ ...summary, jobs: expect.anything(), agent: null, error: 'agent boom' })
  })
})
