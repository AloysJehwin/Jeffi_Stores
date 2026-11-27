import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({ agents: vi.fn(), find: vi.fn(), create: vi.fn(), query: vi.fn() }))
vi.mock('@controller/lib/outreach/agent/skill/store', () => ({ activeTriggerAgents: h.agents }))
vi.mock('@controller/lib/outreach/agent/store/triggers', () => ({ findTriggerCandidates: h.find }))
vi.mock('@controller/lib/outreach/agent/jobs', () => ({ createJob: h.create }))
vi.mock('@controller/lib/outreach/db', () => ({ outreachPool: () => ({ query: h.query }) }))

import { GET } from '@controller/app/api/(internal)/cron/outreach-triggers/route'

const call = (auth: string | null = 'Bearer test-cron-secret') =>
  GET(new NextRequest('http://localhost/api/cron/outreach-triggers', { headers: auth ? { authorization: auth } : {} }))

const agent = (over: Record<string, unknown> = {}, name = 'Cart nudge') => ({
  skillId: `s-${name}`,
  meta: { name, audience: 'shopper', trigger: { event: 'cart_abandoned' }, inputs: { phone: { role: 'contact' } }, ...over },
})
const cand = (ref: string) => ({ sourceRef: ref, inputs: { phone: '9876543210' }, dueAt: new Date('2026-11-27T10:00:00Z') })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', 'test-cron-secret')
  h.agents.mockResolvedValue([])
  h.find.mockResolvedValue([])
  h.query.mockResolvedValue({ rows: [] })
  h.create.mockResolvedValue({ job: { id: 'j' }, created: true, errors: [] })
})
afterEach(() => vi.unstubAllEnvs())

describe('GET /api/cron/outreach-triggers', () => {
  it('401s a missing or wrong secret without polling', async () => {
    expect((await call(null)).status).toBe(401)
    expect((await call('Bearer nope')).status).toBe(401)
    expect(h.agents).not.toHaveBeenCalled()
  })

  it('200s with zero counts when there are no trigger agents', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ agents: 0, candidates: 0, created: 0, duplicates: 0, failed: 0 })
  })

  it('skips lead-audience and manual-trigger agents', async () => {
    h.agents.mockResolvedValue([agent({ audience: 'lead' }, 'Lead'), agent({ trigger: { event: 'manual' } }, 'Manual')])
    const body = await (await call()).json()
    expect(body.agents).toBe(0)
    expect(h.find).not.toHaveBeenCalled()
  })

  it('creates a job per new candidate and counts known ones as duplicates', async () => {
    const a = agent()
    h.agents.mockResolvedValue([a])
    h.find.mockResolvedValue([cand('c1'), cand('c2'), cand('c3')])
    h.query.mockResolvedValue({ rows: [{ source_ref: 'c2' }] })
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ agents: 1, candidates: 3, created: 2, duplicates: 1, failed: 0 })
    expect(h.find).toHaveBeenCalledWith(a.meta.trigger, a.meta.inputs, expect.any(Date))
    expect(h.query).toHaveBeenCalledWith(expect.stringContaining('outreach_jobs'), [a.skillId, ['c1', 'c2', 'c3']])
    expect(h.create).toHaveBeenCalledTimes(2)
    expect(h.create).toHaveBeenCalledWith({
      skillId: a.skillId,
      inputs: { phone: '9876543210' },
      source: 'event',
      sourceRef: 'c1',
      dueAt: new Date('2026-11-27T10:00:00Z'),
      actor: { id: null, label: 'outreach-triggers' },
    })
  })

  it('does not query for known refs when nothing was found', async () => {
    h.agents.mockResolvedValue([agent()])
    await call()
    expect(h.query).not.toHaveBeenCalled()
    expect(h.create).not.toHaveBeenCalled()
  })

  it('treats a createJob that returns an existing job as a duplicate', async () => {
    h.agents.mockResolvedValue([agent()])
    h.find.mockResolvedValue([cand('c1')])
    h.create.mockResolvedValue({ job: { id: 'j' }, created: false, errors: [] })
    expect(await (await call()).json()).toMatchObject({ created: 0, duplicates: 1, failed: 0 })
  })

  it('caps the jobs created per agent at 100', async () => {
    h.agents.mockResolvedValue([agent()])
    h.find.mockResolvedValue(Array.from({ length: 130 }, (_, i) => cand(`c${i}`)))
    const body = await (await call()).json()
    expect(h.create).toHaveBeenCalledTimes(100)
    expect(body).toMatchObject({ candidates: 130, created: 100 })
  })

  it('reports a create failure but stays 200 when something was created', async () => {
    h.agents.mockResolvedValue([agent()])
    h.find.mockResolvedValue([cand('c1'), cand('c2')])
    h.create.mockResolvedValueOnce({ job: { id: 'j' }, created: true, errors: [] }).mockResolvedValueOnce({ job: null, created: false, errors: ['bad phone'] })
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ created: 1, failed: 1, errors: ['Cart nudge: bad phone'] })
  })

  it('500s when every outcome is an error, and one agent failing does not stop the next', async () => {
    h.agents.mockResolvedValue([agent({}, 'First'), agent({}, 'Second')])
    h.find.mockRejectedValueOnce(new Error('poll down')).mockResolvedValueOnce([cand('c1')])
    h.create.mockResolvedValueOnce({ job: null, created: false, errors: [] })
    const res = await call()
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toMatchObject({ agents: 2, failed: 2, created: 0 })
    expect(body.errors).toEqual(['First: poll down', 'Second: not created'])
  })

  it('falls back to a generic message for an error without one', async () => {
    h.agents.mockResolvedValue([agent()])
    h.find.mockRejectedValue(new Error(''))
    expect((await (await call()).json()).errors).toEqual(['Cart nudge: trigger poll failed'])
  })
})
