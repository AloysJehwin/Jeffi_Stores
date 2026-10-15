import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/db.js', () => ({ db: { query: vi.fn(async () => ({ rows: [], rowCount: 1 })) }, q: vi.fn(async () => []), one: vi.fn(async () => undefined) }))

import { upsertTemplate, archiveTemplate, findTemplate } from '../src/templates'
import { db, one } from '../src/db'

describe('templates', () => {
  beforeEach(() => vi.mocked(one).mockReset().mockResolvedValue(undefined))

  it('rejects the reserved system/ prefix', () => {
    expect(() => upsertTemplate('t1', { slug: 'system/otp', channel: 'sms', name: 'x', body: 'y' })).toThrow(/reserved/)
  })

  it('extracts variables from subject + body on upsert', async () => {
    await upsertTemplate('t1', { slug: 'welcome', channel: 'email', name: 'Welcome', subject: 'Hi {{name}}', body: '<p>{{name}}, your code is {{code}}</p>' })
    const params = vi.mocked(one).mock.calls[0][1] as any[]
    expect(params[6]).toEqual(['name', 'code'])
    expect(params[0]).toBe('t1')
  })

  it('findTemplate prefers the tenant row over system (ORDER BY tenant_id NULLS LAST)', async () => {
    await findTemplate('t1', 'sms', 'otp')
    const [sql, params] = vi.mocked(one).mock.calls[0] as any
    expect(sql).toMatch(/tenant_id NULLS LAST/)
    expect(params).toEqual(['t1', 'sms', 'otp'])
  })

  it('archive returns affected row count', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
    expect(await archiveTemplate('t1', 'sms', 'otp')).toBe(0)
  })
})
