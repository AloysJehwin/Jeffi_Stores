import { describe, it, expect, vi, beforeEach } from 'vitest'

const query = vi.fn()
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query }) }))

import { dueForCalling, findActiveByPhone, listContacts } from '@controller/lib/outreach/contacts'

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
