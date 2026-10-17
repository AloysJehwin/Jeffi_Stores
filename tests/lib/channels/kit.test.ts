import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'

const { query, queryOne, queryMany, getClient } = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  getClient: vi.fn(),
}))
vi.mock('@/lib/shared/db', () => ({ query, queryOne, queryMany, getClient }))
vi.mock('@/lib/shared/admin-notify', () => ({ createAdminNotification: vi.fn() }))
vi.mock('@/lib/shared/mail-audit', () => ({ sendAuditedMail: vi.fn() }))

import { applyFindings, mergeRuleConfig } from '@/lib/channels/alerts-engine'
import { runChange, diffKeys } from '@/lib/channels/change-log'
import { fetchWithRetry, mapLimit, chunk } from '@/lib/channels/ratelimit'
import { withChannelLock, ChannelJobBusyError } from '@/lib/channels/sync-run'

const actor = { adminId: 'a1', email: 'o@s.in' }

beforeEach(() => {
  vi.clearAllMocks()
  query.mockResolvedValue({ rowCount: 0, rows: [] })
  queryOne.mockResolvedValue({ id: '9' })
})

describe('rule config', () => {
  const rs = {
    schema: z.object({ a: z.object({ enabled: z.boolean(), n: z.number().min(1).max(10) }), b: z.object({ enabled: z.boolean() }) }),
    defaults: { a: { enabled: true, n: 5 }, b: { enabled: false } },
  }
  it('merges stored values over defaults and drops invalid rules', () => {
    expect(mergeRuleConfig(rs as any, JSON.stringify({ a: { n: 50 }, b: { enabled: true } }))).toEqual({ a: { enabled: true, n: 5 }, b: { enabled: true } })
    expect(mergeRuleConfig(rs as any, 'nope')).toEqual(rs.defaults)
  })
})

describe('applyFindings', () => {
  it('scopes keys to the channel and resolves cleared ones', async () => {
    queryOne.mockImplementation(async (sql: string, p: any[]) => {
      if (sql.startsWith('UPDATE')) return p[1] === 'old' ? { id: '1' } : null
      return { id: '2', dedupe_key: p[2] }
    })
    query.mockResolvedValue({ rowCount: 4 })
    const r = await applyFindings('amazon', [
      { rule: 'x', key: 'old', severity: 'warning', title: 't', message: '' },
      { rule: 'x', key: 'new', severity: 'warning', title: 't', message: '' },
    ])
    expect(r.created.map(c => c.dedupe_key)).toEqual(['new'])
    expect(r.resolved).toBe(4)
    expect(queryOne.mock.calls[0][1][0]).toBe('amazon')
    expect(query.mock.calls[0][1]).toEqual(['amazon', ['old', 'new']])
  })
})

describe('runChange', () => {
  it('returns the preview without applying or logging', async () => {
    const apply = vi.fn()
    const r = await runChange({ channel: 'gmc', action: 'x', entityType: 'product', summary: 'Set price', before: { p: 1 }, after: { p: 2 }, apply }, actor, true)
    expect(r).toMatchObject({ ok: true, preview: true, before: { p: 1 }, after: { p: 2 } })
    expect(apply).not.toHaveBeenCalled()
    expect(queryOne).not.toHaveBeenCalled()
  })
  it('rejects on validation problems and logs it', async () => {
    const apply = vi.fn()
    const r = await runChange({ channel: 'gmc', action: 'x', entityType: 'p', summary: 's', validate: () => ['Too low'], apply }, actor, false)
    expect(r).toMatchObject({ ok: false, problems: ['Too low'] })
    expect(apply).not.toHaveBeenCalled()
    expect(queryOne.mock.calls[0][1][9]).toBe('rejected')
  })
  it('logs applied and failed attempts', async () => {
    const ok = await runChange({ channel: 'amazon', action: 'x', entityType: 'p', summary: 's', apply: async () => 7 }, actor, false)
    expect(ok).toMatchObject({ ok: true, result: 7, logId: '9' })
    const bad = await runChange({ channel: 'amazon', action: 'x', entityType: 'p', summary: 's', apply: async () => { throw new Error('Refused') } }, actor, false)
    expect(bad).toMatchObject({ ok: false, problems: ['Refused'] })
    expect(queryOne.mock.calls.map(c => c[1][9])).toEqual(['applied', 'failed'])
  })
  it('diffs flat objects', () => {
    expect(diffKeys({ a: 1, b: 2 }, { a: 1, b: 3, c: 4 })).toEqual(['b', 'c'])
  })
})

describe('fetchWithRetry', () => {
  it('retries 429 and 5xx, then returns the last response', async () => {
    const res = (s: number, h: Record<string, string> = {}) => new Response('{}', { status: s, headers: h })
    const f = vi.fn().mockResolvedValueOnce(res(429, { 'retry-after': '0' })).mockResolvedValueOnce(res(503)).mockResolvedValueOnce(res(200))
    vi.stubGlobal('fetch', f)
    const sleep = vi.fn(async (_ms: number) => {})
    const r = await fetchWithRetry('https://x', {}, { delays: [1, 1, 1], sleep })
    expect(r.status).toBe(200)
    expect(sleep.mock.calls.map(c => c[0])).toEqual([0, 1])
    f.mockReset().mockResolvedValue(res(400))
    expect((await fetchWithRetry('https://x', {}, { sleep })).status).toBe(400)
    expect(f).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })
  it('maps with a limit and chunks', async () => {
    expect(await mapLimit([1, 2, 3, 4], 2, async x => x * 2)).toEqual([2, 4, 6, 8])
    expect(chunk([1, 2, 3], 2)).toEqual([[1, 2], [3]])
  })
})

describe('withChannelLock', () => {
  const client = (acquired: boolean) => {
    const q = vi.fn(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired }] }
      if (sql.startsWith('INSERT INTO channel_sync_log')) return { rows: [{ id: '5' }] }
      return { rows: [] }
    })
    return { query: q, release: vi.fn() }
  }
  it('refuses a second run', async () => {
    getClient.mockResolvedValue(client(false))
    await expect(withChannelLock('gmc', 'gmc_reports', 'reports', async () => {})).rejects.toBeInstanceOf(ChannelJobBusyError)
  })
  it('records step counts and errors; partial when some steps fail', async () => {
    const c = client(true)
    getClient.mockResolvedValue(c)
    const r = await withChannelLock('gmc', 'gmc_reports', 'reports', async ctx => {
      await ctx.step('a', async () => 3)
      await ctx.step('b', async () => {
        throw new Error('boom')
      })
    })
    expect(r).toMatchObject({ id: '5', status: 'partial', counts: { a: 3 }, errors: [{ step: 'b', message: 'boom' }] })
    expect(c.query.mock.calls.some(x => String(x[0]).includes('pg_advisory_unlock'))).toBe(true)
    expect(c.release).toHaveBeenCalled()
  })
})
