import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('@controller/lib/outreach/db', () => ({ outreachPool: () => ({ query: h.query }) }))

import * as runs from '@controller/lib/outreach/agent/runs'

const NOW = new Date('2026-11-27T06:00:00Z')
const sqls = () => h.query.mock.calls.map(c => String(c[0]).replace(/\s+/g, ' '))
const events = () => h.query.mock.calls.filter(c => String(c[0]).startsWith('INSERT INTO outreach_events')).map(c => ({ kind: c[1][2], data: JSON.parse(c[1][3]), actor: c[1][4] }))

beforeEach(() => {
  vi.clearAllMocks()
  h.query.mockResolvedValue({ rows: [], rowCount: 0 })
})

describe('runs', () => {
  it('getOpenRun reads the active or handed-off run', async () => {
    h.query.mockResolvedValueOnce({ rows: [{ id: 'r1' }] })
    expect(await runs.getOpenRun('k1')).toEqual({ id: 'r1' })
    expect(sqls()[0]).toContain(`status IN ('active', 'handed_off')`)
    h.query.mockResolvedValueOnce({ rows: [] })
    expect(await runs.getOpenRun('k1')).toBeNull()
  })

  it('createRun inserts ON CONFLICT DO NOTHING, then returns the open run', async () => {
    h.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 'r-existing', contact_id: 'k1' }] })
    const r = await runs.createRun({ contactId: 'k1', skillVersionId: null, skillRef: 'showcase-offer/2026-11-24.1' })
    expect(r.id).toBe('r-existing')
    expect(sqls()[0]).toMatch(/^INSERT INTO outreach_agent_runs .* ON CONFLICT DO NOTHING/)
    expect(h.query.mock.calls[0][1]).toEqual(['k1', null, 'showcase-offer/2026-11-24.1'])
  })

  it('createRun throws when no run can be read back', async () => {
    await expect(runs.createRun({ contactId: 'k1', skillVersionId: null, skillRef: 'x' })).rejects.toThrow(/No open agent run/)
  })

  it('recordTurn counts the turn and the spend', async () => {
    await runs.recordTurn('r1', 'whatsapp', 12.4, NOW)
    expect(sqls()[0]).toContain('turns = turns + 1')
    expect(h.query.mock.calls[0][1]).toEqual(['r1', 'whatsapp', 12, NOW])
  })

  it('setRunStatus ends a run only for completed / stopped', async () => {
    await runs.setRunStatus('r1', 'completed', NOW)
    expect(sqls()[0]).toContain('ended_at = CASE')
    expect(h.query.mock.calls[0][1]).toEqual(['r1', 'completed', NOW])
  })

  it('handOff flags the contact, hands the run off, cancels tasks and records the event', async () => {
    await runs.handOff({ contactId: 'k1', reason: 'wants a person', channel: 'whatsapp', actor: 'outreach:agent', now: NOW })
    const s = sqls()
    expect(s[0]).toContain('UPDATE outreach_contacts SET handoff_at')
    expect(s[0]).not.toContain('status =')
    expect(s[1]).toContain(`UPDATE outreach_agent_runs SET status = 'handed_off'`)
    expect(s[2]).toContain(`UPDATE outreach_agent_tasks SET status = 'cancelled'`)
    expect(events()).toEqual([{ kind: 'handoff', data: { reason: 'wants a person', channel: 'whatsapp' }, actor: 'outreach:agent' }])
  })

  it('resume is false when nothing was handed off, true (with an event) otherwise', async () => {
    expect(await runs.resume('k1', 'admin:1', NOW)).toBe(false)
    expect(events()).toEqual([])
    h.query.mockResolvedValueOnce({ rows: [{ id: 'k1' }] }).mockResolvedValueOnce({ rows: [{ id: 'r1' }] })
    expect(await runs.resume('k1', 'admin:1', NOW)).toBe(true)
    expect(events()[0]).toMatchObject({ kind: 'agent_resumed', actor: 'admin:1' })
  })

  it('scheduleTask inserts and returns the row', async () => {
    h.query.mockResolvedValueOnce({ rows: [{ id: 't1', kind: 'call' }] })
    const t = await runs.scheduleTask({ runId: 'r1', contactId: 'k1', kind: 'call', dueAt: NOW, reason: 'callback', createdBy: 'voice' })
    expect(t.id).toBe('t1')
    expect(h.query.mock.calls[0][1]).toEqual(['r1', 'k1', 'call', NOW, 'callback', null, 'voice'])
  })

  it('cancelTasks cancels pending tasks, optionally one kind', async () => {
    h.query.mockResolvedValueOnce({ rows: [], rowCount: 2 })
    expect(await runs.cancelTasks('k1', 'handoff', 'call')).toBe(2)
    expect(sqls()[0]).toContain(`status = 'pending' AND kind = $3`)
    await runs.cancelTasks('k1', 'handoff')
    expect(sqls()[1]).not.toContain('kind = $3')
  })

  it('claimDueTasks claims with SKIP LOCKED and returns them due-first', async () => {
    h.query.mockResolvedValueOnce({ rows: [{ id: 'b', due_at: '2026-11-27T07:00:00Z' }, { id: 'a', due_at: '2026-11-27T05:00:00Z' }] })
    const t = await runs.claimDueTasks(NOW, 5)
    expect(t.map(x => x.id)).toEqual(['a', 'b'])
    expect(sqls()[0]).toContain('FOR UPDATE SKIP LOCKED')
    expect(sqls()[0]).toContain(`status = 'running', attempts = attempts + 1`)
    expect(h.query.mock.calls[0][1]).toEqual([NOW, 5])
  })

  it('finishTask ends a task, or reschedules it with pending + dueAt', async () => {
    await runs.finishTask('t1', 'done', { ran: true })
    expect(sqls()[0]).toContain('done_at = now()')
    expect(h.query.mock.calls[0][1]).toEqual(['t1', 'done', '{"ran":true}'])
    await runs.finishTask('t1', 'pending', null, NOW)
    expect(sqls()[1]).toContain(`status = 'pending', due_at = COALESCE($3, due_at)`)
    expect(h.query.mock.calls[1][1]).toEqual(['t1', null, NOW])
  })

  it('listTasks and pendingTaskCount', async () => {
    h.query.mockResolvedValueOnce({ rows: [{ id: 't1' }] }).mockResolvedValueOnce({ rows: [{ n: 2 }] })
    expect(await runs.listTasks('k1')).toEqual([{ id: 't1' }])
    expect(await runs.pendingTaskCount('k1')).toBe(2)
  })
})
