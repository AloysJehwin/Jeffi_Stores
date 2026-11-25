import { describe, it, expect, vi, beforeEach } from 'vitest'

const client = { query: vi.fn(), release: vi.fn() }
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query: vi.fn(), connect: async () => client }) }))

import { canTransition, transition, InvalidTransitionError, ContactNotFoundError, nextAttemptAt } from '@controller/lib/outreach/state'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('canTransition', () => {
  it('allows the forward pipeline', () => {
    const path = ['new', 'queued', 'calling', 'interested', 'building', 'preview_sent', 'published', 'claimed'] as const
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i], path[i + 1]), `${path[i]}->${path[i + 1]}`).toBe(true)
  })

  it('allows the retry loop', () => {
    expect(canTransition('calling', 'no_answer')).toBe(true)
    expect(canTransition('no_answer', 'calling')).toBe(true)
    expect(canTransition('no_answer', 'failed')).toBe(true)
    expect(canTransition('calling', 'callback')).toBe(true)
    expect(canTransition('callback', 'calling')).toBe(true)
  })

  it('rejects skips, no-ops and moves out of final states', () => {
    expect(canTransition('new', 'published')).toBe(false)
    expect(canTransition('queued', 'queued')).toBe(false)
    expect(canTransition('claimed', 'queued')).toBe(false)
    expect(canTransition('dnd', 'queued')).toBe(false)
    expect(canTransition('opted_out', 'queued')).toBe(false)
    expect(canTransition('suppressed', 'queued')).toBe(false)
    expect(canTransition('not_interested', 'published')).toBe(false)
  })

  it('lets suppress and opt-out in from anywhere live', () => {
    for (const from of ['new', 'queued', 'calling', 'interested', 'building', 'published', 'claimed', 'failed', 'dnd'] as const) {
      expect(canTransition(from, 'suppressed'), from).toBe(true)
    }
    expect(canTransition('calling', 'opted_out')).toBe(true)
    expect(canTransition('suppressed', 'opted_out')).toBe(false)
    expect(canTransition('suppressed', 'suppressed')).toBe(false)
  })

  it('allows a manual requeue from the stopped states', () => {
    for (const from of ['not_interested', 'wrong_number', 'failed'] as const) expect(canTransition(from, 'queued'), from).toBe(true)
  })
})

describe('transition', () => {
  const run = (status: string | null, set?: Record<string, unknown>) => {
    client.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT status')) return { rows: status ? [{ status }] : [] }
      if (sql.startsWith('UPDATE')) return { rows: [{ id: 'c1', status: 'calling' }] }
      return { rows: [] }
    })
    return transition({ id: 'c1' }, 'calling', { actor: 'worker', data: { x: 1 }, set })
  }

  it('writes the status and an event in one transaction', async () => {
    await run('queued', { attempts: 1 })
    const sqls = client.query.mock.calls.map(c => c[0] as string)
    expect(sqls[0]).toBe('BEGIN')
    expect(sqls[1]).toContain('FOR UPDATE')
    expect(sqls[2]).toContain('UPDATE outreach_contacts SET status = $2')
    expect(sqls[2]).toContain('attempts = $3')
    expect(sqls[3]).toContain('INSERT INTO outreach_events')
    expect(sqls[4]).toBe('COMMIT')
    const ev = client.query.mock.calls[3][1]
    expect(ev[0]).toBe('c1')
    expect(ev[2]).toBe('status_change')
    expect(JSON.parse(ev[3])).toEqual({ from: 'queued', to: 'calling', x: 1 })
    expect(ev[4]).toBe('worker')
    expect(client.release).toHaveBeenCalled()
  })

  it('rolls back an invalid move and writes nothing', async () => {
    await expect(run('claimed')).rejects.toBeInstanceOf(InvalidTransitionError)
    const sqls = client.query.mock.calls.map(c => c[0] as string)
    expect(sqls).toContain('ROLLBACK')
    expect(sqls.some(s => s.startsWith('UPDATE'))).toBe(false)
    expect(sqls.some(s => s.includes('outreach_events'))).toBe(false)
    expect(client.release).toHaveBeenCalled()
  })

  it('reports a missing contact', async () => {
    await expect(run(null)).rejects.toBeInstanceOf(ContactNotFoundError)
  })

  it('refuses columns outside the whitelist', async () => {
    await expect(run('queued', { phone: '+910000000000' })).rejects.toThrow(/not settable/)
  })
})

describe('nextAttemptAt', () => {
  const now = new Date('2026-11-24T10:00:00Z')
  it('retries a no-answer after 4h until the third attempt', () => {
    expect(nextAttemptAt('no_answer', 1, now)?.toISOString()).toBe('2026-11-24T14:00:00.000Z')
    expect(nextAttemptAt('no_answer', 2, now)).not.toBeNull()
    expect(nextAttemptAt('no_answer', 3, now)).toBeNull()
  })
  it('uses the callback time', () => {
    const at = new Date('2026-11-25T05:00:00Z')
    expect(nextAttemptAt('callback', 1, now, at)).toBe(at)
  })
})
