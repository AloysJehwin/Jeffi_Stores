import { describe, it, expect, vi, beforeEach } from 'vitest'

const query = vi.fn()
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query }) }))

import { dueForCalling, findActiveByPhone, getContactDetail, listContacts } from '@controller/lib/outreach/contacts'

beforeEach(() => {
  vi.clearAllMocks()
  query.mockResolvedValue({ rows: [{ id: 'c1' }] })
})

describe('dueForCalling', () => {
  it('asks for queued, retry and callback contacts that are callable now', async () => {
    const now = new Date('2026-11-24T05:00:00Z')
    const rows = await dueForCalling('showcase-offer', now, 5)
    expect(rows).toEqual([{ id: 'c1' }])
    const [sql, params] = query.mock.calls[0]
    expect(sql).toContain("status IN ('queued', 'no_answer', 'callback')")
    expect(sql).toContain('next_attempt_at <= $2')
    expect(sql).toContain('attempts < $3')
    expect(sql).toContain("dnd_status <> 'dnd'")
    expect(sql).toContain('opted_out_at IS NULL')
    expect(sql).toContain('outreach_suppressions')
    expect(params).toEqual(['showcase-offer', now, 3, 5])
  })

  it('never asks for a negative limit', async () => {
    await dueForCalling('showcase-offer', new Date(), -2)
    expect(query.mock.calls[0][1][3]).toBe(0)
  })
})

describe('findActiveByPhone', () => {
  it('looks up the E.164 number among engaged contacts of the last 30 days', async () => {
    const now = new Date('2026-11-24T00:00:00Z')
    expect(await findActiveByPhone('98765 43210', now)).toEqual({ id: 'c1' })
    const [, params] = query.mock.calls[0]
    expect(params[0]).toBe('+919876543210')
    expect(params[1]).toEqual(['interested', 'building', 'preview_sent', 'published', 'claimed'])
    expect(params[2]).toEqual(new Date('2026-10-25T00:00:00Z'))
  })

  it('skips the query for a number that is not an Indian mobile', async () => {
    expect(await findActiveByPhone('12345')).toBeNull()
    expect(query).not.toHaveBeenCalled()
  })
})

describe('listContacts', () => {
  it('filters, pages and counts', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'c1' }] }).mockResolvedValueOnce({ rows: [{ n: 120 }] })
    const out = await listContacts({ program: 'showcase-offer', statuses: ['queued', 'no_answer'], listId: 'l1', q: 'sri', page: 3, pageSize: 20 })
    expect(out).toMatchObject({ total: 120, page: 3, pageSize: 20 })
    const [sql, params] = query.mock.calls[0]
    expect(sql).toContain('program = $1')
    expect(sql).toContain('status = ANY($2)')
    expect(sql).toContain('list_id = $3')
    expect(sql).toContain('ILIKE $4')
    expect(sql).toContain('LIMIT 20 OFFSET 40')
    expect(params).toEqual(['showcase-offer', ['queued', 'no_answer'], 'l1', '%sri%'])
  })
})

describe('getContactDetail', () => {
  const answer = (rows: Record<string, unknown[]>) =>
    query.mockImplementation(async (sql: string) => {
      const key = Object.keys(rows).find(k => sql.includes(k))
      return { rows: key ? rows[key] : [] }
    })

  it('carries the contact, its history and the agent run with its tasks', async () => {
    answer({
      'FROM outreach_contacts WHERE id': [{ id: 'k1' }],
      "status IN ('active', 'handed_off')": [{ id: 'r1', status: 'active' }],
      'FROM outreach_agent_tasks': [{ id: 't1', kind: 'call' }],
    })
    const d = await getContactDetail('k1')
    expect(d!.contact).toEqual({ id: 'k1' })
    expect(d!.agent).toEqual({ run: { id: 'r1', status: 'active' }, tasks: [{ id: 't1', kind: 'call' }] })
  })

  it('falls back to the latest run when none is open, and to null when there never was one', async () => {
    answer({ 'FROM outreach_contacts WHERE id': [{ id: 'k1' }], 'contact_id = $1 ORDER BY started_at DESC LIMIT 1': [{ id: 'r0', status: 'completed' }] })
    expect((await getContactDetail('k1'))!.agent.run).toEqual({ id: 'r0', status: 'completed' })
    answer({ 'FROM outreach_contacts WHERE id': [{ id: 'k1' }] })
    expect((await getContactDetail('k1'))!.agent).toEqual({ run: null, tasks: [] })
  })

  it('is null for an unknown contact', async () => {
    answer({})
    expect(await getContactDetail('nope')).toBeNull()
  })
})
