import { describe, it, expect, beforeEach, vi } from 'vitest'

const db = { query: vi.fn(), release: vi.fn() }
vi.mock('@/lib/shared/db', () => ({ getClient: vi.fn(async () => db), queryOne: vi.fn() }))
vi.mock('@/lib/google-ads/credentials', () => ({ googleAdsClientFor: vi.fn() }))

import {
  syncGoogleAds,
  syncRange,
  dateInZone,
  bulkInsert,
  isAdsSyncRunning,
  AdsSyncInProgressError,
  ADS_SYNC_LOCK_KEY,
} from '@/lib/google-ads/sync'
import { googleAdsClientFor } from '@/lib/google-ads/credentials'
import { queryOne } from '@/lib/shared/db'

const NOW = new Date('2026-10-16T05:00:00Z')
const customerRow = { customer: { id: '1234567890', descriptiveName: 'Acme', currencyCode: 'INR', timeZone: 'Asia/Kolkata' } }

function fakeAds(overrides: Record<string, any[] | Error> = {}) {
  const canned: Record<string, any[] | Error> = {
    'FROM customer ': [customerRow],
    'FROM account_budget': [],
    "FROM campaign\n     WHERE campaign.status": [{ campaign: { id: '11', name: 'Search', status: 'ENABLED' } }],
    'FROM campaign\n     WHERE segments': [
      { campaign: { id: '11' }, segments: { date: '2026-10-16', device: 'MOBILE', adNetworkType: 'SEARCH' }, metrics: { clicks: '4', costMicros: '2000000' } },
    ],
    'FROM ad_group\n     WHERE segments': [],
    'FROM shopping_performance_view': [],
    'FROM search_term_view': [],
    'FROM user_location_view': [],
    'FROM ad_group\n     WHERE ad_group.status': [],
    'FROM ad_group_ad': [],
    'FROM keyword_view': [],
    'FROM recommendation': [],
    'FROM change_event': [],
    ...overrides,
  }
  return {
    loginCustomerId: null,
    searchStream: vi.fn(async (q: string) => {
      const key = Object.keys(canned).find(k => q.includes(k))
      if (!key) throw new Error(`unexpected query ${q.slice(0, 60)}`)
      const v = canned[key]
      if (v instanceof Error) throw v
      return v
    }),
  } as any
}

const sqlCalls = () => db.query.mock.calls.map(c => String(c[0]))

beforeEach(() => {
  vi.clearAllMocks()
  db.query.mockImplementation(async (sql: string) => {
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }] }
    return { rows: [] }
  })
})

describe('date windows', () => {
  it('uses the account time zone for today', () => {
    // 22:00 UTC on the 15th is already the 16th in India.
    expect(dateInZone(new Date('2026-10-15T22:00:00Z'), 'Asia/Kolkata')).toBe('2026-10-16')
    expect(dateInZone(new Date('2026-10-15T22:00:00Z'), 'America/New_York')).toBe('2026-10-15')
    expect(dateInZone(new Date('2026-10-15T22:00:00Z'), 'Not/AZone')).toBe('2026-10-16')
  })

  it('full = last 30 days, today = one day', () => {
    expect(syncRange('full', 'Asia/Kolkata', NOW)).toEqual({ from: '2026-09-17', to: '2026-10-16' })
    expect(syncRange('today', 'Asia/Kolkata', NOW)).toEqual({ from: '2026-10-16', to: '2026-10-16' })
  })
})

describe('bulkInsert', () => {
  it('chunks rows into numbered placeholders', async () => {
    const q = { query: vi.fn(async () => ({ rows: [] })) }
    const rows = Array.from({ length: 1001 }, (_, i) => [i, `n${i}`])
    expect(await bulkInsert(q as any, 't', ['a', 'b'], rows, 'ON CONFLICT DO NOTHING')).toBe(1001)
    expect(q.query).toHaveBeenCalledTimes(3)
    const [sql, params] = (q.query.mock.calls[2] as any[])
    expect(sql).toBe('INSERT INTO t (a,b) VALUES ($1,$2) ON CONFLICT DO NOTHING')
    expect(params).toEqual([1000, 'n1000'])
  })
})

describe('syncGoogleAds', () => {
  it('refuses to overlap a running sync and releases the connection', async () => {
    db.query.mockImplementation(async (sql: string) =>
      sql.includes('pg_try_advisory_lock') ? { rows: [{ acquired: false }] } : { rows: [] }
    )
    await expect(syncGoogleAds('full', { client: fakeAds(), now: NOW })).rejects.toBeInstanceOf(AdsSyncInProgressError)
    expect(sqlCalls().some(s => s.includes('pg_advisory_unlock'))).toBe(false)
    expect(db.release).toHaveBeenCalledTimes(1)
  })

  it('upserts the account, replaces date windows, logs success and unlocks', async () => {
    const r = await syncGoogleAds('full', { client: fakeAds(), now: NOW })
    expect(r.status).toBe('success')
    expect(r.range).toEqual({ from: '2026-09-17', to: '2026-10-16' })
    expect(r.rows).toMatchObject({ campaigns: 1, daily_metrics: 1 })

    const sql = sqlCalls()
    expect(db.query.mock.calls[0]).toEqual(['SELECT pg_try_advisory_lock($1) AS acquired', [ADS_SYNC_LOCK_KEY]])
    expect(sql.some(s => s.startsWith('INSERT INTO ads_account') && s.includes('ON CONFLICT (id) DO UPDATE'))).toBe(true)
    expect(sql.some(s => s.startsWith('INSERT INTO ads_campaigns') && s.includes('ON CONFLICT (campaign_id) DO UPDATE'))).toBe(true)
    const del = db.query.mock.calls.find(c => String(c[0]).startsWith('DELETE FROM ads_daily_metrics'))
    expect(del?.[1]).toEqual(['2026-09-17', '2026-10-16'])
    const ins = db.query.mock.calls.find(c => String(c[0]).startsWith('INSERT INTO ads_daily_metrics'))
    expect(ins?.[1]).toEqual(['2026-10-16', '11', '0', 'MOBILE', 'SEARCH', 0, 4, 2000000, 0, 0, 0])
    expect(sql.some(s => s.includes('last_full_sync_at = now()'))).toBe(true)

    const log = db.query.mock.calls.find(c => String(c[0]).includes('INSERT INTO ads_sync_log'))
    expect(log?.[1].slice(0, 4)).toEqual(['full', 'success', '2026-09-17', '2026-10-16'])
    expect(sql[sql.length - 1]).toBe('SELECT pg_advisory_unlock($1)')
    expect(db.release).toHaveBeenCalledWith(undefined)
  })

  it('records a failed step as partial and keeps going', async () => {
    const r = await syncGoogleAds('full', {
      client: fakeAds({ 'FROM search_term_view': new Error('Cannot select x with y (PROHIBITED_FIELD_COMBINATION)') }),
      now: NOW,
    })
    expect(r.status).toBe('partial')
    expect(r.errors).toEqual([{ step: 'search_terms', message: 'Cannot select x with y (PROHIBITED_FIELD_COMBINATION)' }])
    expect(r.rows.recommendations).toBe(0)
    // A partial run does not count as a complete full sync.
    expect(sqlCalls().some(s => s.includes('last_full_sync_at'))).toBe(false)
  })

  it('logs an error when the account cannot be read', async () => {
    vi.mocked(googleAdsClientFor).mockRejectedValue(new Error("Integration 'google_ads' is not connected for tenant t1"))
    const r = await syncGoogleAds('full', { now: NOW })
    expect(r.status).toBe('error')
    expect(r.errors[0]).toMatchObject({ step: 'account' })
    const log = db.query.mock.calls.find(c => String(c[0]).includes('INSERT INTO ads_sync_log'))
    expect(log?.[1][1]).toBe('error')
    expect(sqlCalls().some(s => s.includes('pg_advisory_unlock'))).toBe(true)
  })

  it('today mode refreshes metrics only', async () => {
    const ads = fakeAds()
    const r = await syncGoogleAds('today', { client: ads, now: NOW })
    expect(r.range).toEqual({ from: '2026-10-16', to: '2026-10-16' })
    const queries = ads.searchStream.mock.calls.map((c: any[]) => String(c[0]))
    expect(queries.some((q: string) => q.includes('FROM recommendation'))).toBe(false)
    expect(queries.some((q: string) => q.includes('FROM change_event'))).toBe(false)
    expect(queries.some((q: string) => q.includes('FROM account_budget'))).toBe(false)
    expect(r.rows).toHaveProperty('daily_metrics')
  })

  it('destroys the connection when unlock fails', async () => {
    db.query.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }] }
      if (sql.includes('pg_advisory_unlock')) throw new Error('connection lost')
      return { rows: [] }
    })
    await syncGoogleAds('today', { client: fakeAds(), now: NOW })
    expect(db.release).toHaveBeenCalledWith(true)
  })
})

describe('isAdsSyncRunning', () => {
  it('checks pg_locks for the sync lock key', async () => {
    vi.mocked(queryOne).mockResolvedValue({ running: true })
    expect(await isAdsSyncRunning()).toBe(true)
    expect(vi.mocked(queryOne).mock.calls[0][1]).toEqual([ADS_SYNC_LOCK_KEY])
  })
})
