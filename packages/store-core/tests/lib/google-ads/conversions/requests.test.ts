import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), getClient: vi.fn(), queryOne: vi.fn() }))

import {
  failedRequestOutcome,
  listDataManagerRequests,
  normalizeRequestStatus,
  pollRequestStatuses,
  recordRequest,
} from '@/lib/google-ads/conversions/requests'
import { DataManagerApiError, SCOPE_MISSING } from '@/lib/google-ads/conversions/data-manager'
import type { UploadRunSummary } from '@/lib/google-ads/conversions/types'

const NOW = new Date('2026-10-16T06:00:00Z')
const MIN = 60_000
const HOUR = 60 * MIN

const run = (): UploadRunSummary => ({
  status: 'idle',
  uploaded: 0,
  failed: 0,
  retrying: 0,
  skipped: 0,
  enqueued: 0,
  error: null,
  errorCode: null,
  identifiers: false,
  finishedAt: '',
})

function fakeDb(requests: Record<string, unknown>[], rowsByRequest: Record<string, unknown[]> = {}) {
  return {
    query: vi.fn(async (sql: string, params?: any[]) => {
      if (sql.includes('FROM ads_conversion_requests') && sql.includes('finished_at IS NULL')) return { rows: requests }
      if (sql.includes('FROM ads_conversion_uploads WHERE request_id = $1')) return { rows: rowsByRequest[String(params?.[0])] ?? [] }
      return { rows: [], rowCount: 0 }
    }),
  }
}

const requestUpdate = (db: ReturnType<typeof fakeDb>, id: string) =>
  (db.query.mock.calls as unknown as [string, any[]][]).find(c => c[0].startsWith('UPDATE ads_conversion_requests') && c[1][0] === id)?.[1]

const rowUpdates = (db: ReturnType<typeof fakeDb>) => {
  const out: Record<number, any> = {}
  for (const [sql, p] of db.query.mock.calls as [string, any[]][]) {
    if (!sql.startsWith('UPDATE ads_conversion_uploads u SET')) continue
    p[0].forEach((id: number, i: number) => (out[id] = { status: p[1][i], inc: p[2][i], code: p[3][i], error: p[4][i], nextAt: p[5][i] }))
  }
  return out
}

const status = (requestStatus: string, extra: Record<string, unknown> = {}) => ({
  requestStatusPerDestination: [{ requestStatus, eventsIngestionStatus: { recordCount: '2' }, ...extra }],
})

beforeEach(() => vi.clearAllMocks())

describe('request records', () => {
  it('records an accepted request, first read 30 minutes later', async () => {
    const db = fakeDb([])
    await recordRequest(db, { requestId: 'r1', kind: 'purchase', events: 4, fieldWarnings: [{ field: 'f', reason: 'W', description: 'd' }], now: NOW })
    expect(db.query.mock.calls[0][1]).toEqual(['r1', 'purchase', 4, '[{"field":"f","reason":"W","description":"d"}]', new Date(NOW.getTime() + 30 * MIN), NOW])
    expect(String(db.query.mock.calls[0][0])).toContain('ON CONFLICT (request_id) DO NOTHING')
  })

  it("normalises Google's status names", () => {
    expect(normalizeRequestStatus('FAILURE')).toBe('FAILED')
    expect(normalizeRequestStatus('FAILED')).toBe('FAILED')
    expect(normalizeRequestStatus('PARTIAL_SUCCESS')).toBe('PARTIAL_SUCCESS')
    expect(normalizeRequestStatus('REQUEST_STATUS_UNKNOWN')).toBe('PROCESSING')
    expect(normalizeRequestStatus(undefined)).toBe('PROCESSING')
  })
})

describe('failedRequestOutcome', () => {
  it('applies a single reason to every row', () => {
    expect(failedRequestOutcome([{ reason: 'PROCESSING_ERROR_REASON_EXPIRED_CLICK', count: 3 }])).toMatchObject({
      code: 'PROCESSING_ERROR_REASON_EXPIRED_CLICK',
      c: { outcome: 'skipped' },
    })
    expect(failedRequestOutcome([{ reason: 'PROCESSING_ERROR_REASON_TOO_RECENT_CLICK', count: 1 }]).c).toMatchObject({ outcome: 'retry', delayMs: 6 * HOUR })
    expect(failedRequestOutcome([{ reason: 'PROCESSING_ERROR_REASON_DUPLICATE_TRANSACTION_ID', count: 1 }]).c.outcome).toBe('uploaded')
  })

  it('applies reasons that share a handling, and fails a mix for a manual retry', () => {
    const same = failedRequestOutcome([
      { reason: 'PROCESSING_ERROR_REASON_EXPIRED_CLICK', count: 1 },
      { reason: 'PROCESSING_ERROR_REASON_CLICK_NOT_FOUND', count: 2 },
    ])
    expect(same).toMatchObject({ code: 'PROCESSING_FAILED', c: { outcome: 'skipped' } })
    expect(same.c.message).toContain('Expired click x1, Click not found x2')
    const mixed = failedRequestOutcome([
      { reason: 'PROCESSING_ERROR_REASON_EXPIRED_CLICK', count: 1 },
      { reason: 'PROCESSING_ERROR_REASON_TOO_RECENT_CLICK', count: 1 },
    ])
    expect(mixed).toMatchObject({ code: 'PROCESSING_FAILED', c: { outcome: 'failed' } })
    expect(failedRequestOutcome([]).c).toMatchObject({ outcome: 'failed', message: expect.stringContaining('without a reason') })
  })
})

describe('pollRequestStatuses', () => {
  const req = (id: string, o: Record<string, unknown> = {}) => ({ request_id: id, kind: 'purchase', checks: 0, created_at: '2026-10-16T05:00:00Z', ...o })

  it("stores Google's verdict and maps a fully rejected request onto its rows", async () => {
    const db = fakeDb([req('ok'), req('bad'), req('slow', { checks: 2 }), req('late', { checks: 20, created_at: '2026-10-15T05:00:00Z' })], {
      bad: [
        { id: 7, attempts: 1 },
        { id: 8, attempts: 0 },
      ],
    })
    const dm = {
      retrieveRequestStatus: vi.fn(async (id: string) => {
        if (id === 'ok') return status('SUCCESS', { warningInfo: { warningCounts: [{ reason: 'PROCESSING_WARNING_REASON_INTERNAL_ERROR', recordCount: '1' }] } })
        if (id === 'bad') return status('FAILED', { errorInfo: { errorCounts: [{ reason: 'PROCESSING_ERROR_REASON_EXPIRED_CLICK', recordCount: '2' }] } })
        return status('PROCESSING')
      }),
    } as any
    const r = run()
    const out = await pollRequestStatuses({ db, dm, now: NOW, run: r })
    expect(out).toEqual({ checked: 4, blocked: null })

    expect(requestUpdate(db, 'ok')).toEqual([
      'ok',
      'SUCCESS',
      2,
      '[]',
      '[{"reason":"PROCESSING_WARNING_REASON_INTERNAL_ERROR","count":1}]',
      1,
      NOW,
      new Date(NOW.getTime() + 39 * MIN),
      NOW,
    ])
    expect(requestUpdate(db, 'bad')!.slice(0, 4)).toEqual(['bad', 'FAILED', 2, '[{"reason":"PROCESSING_ERROR_REASON_EXPIRED_CLICK","count":2}]'])
    // Still processing: next read after 30 x 1.3^3 minutes, capped at an hour; not finished.
    expect(requestUpdate(db, 'slow')!.slice(1, 2)).toEqual(['PROCESSING'])
    expect(requestUpdate(db, 'slow')![7]).toEqual(new Date(NOW.getTime() + 60 * MIN))
    expect(requestUpdate(db, 'slow')![8]).toBeNull()
    // Past 24 hours without an answer.
    expect(requestUpdate(db, 'late')!.slice(1, 2)).toEqual(['TIMED_OUT'])
    expect(requestUpdate(db, 'late')![8]).toEqual(NOW)

    const rows = rowUpdates(db)
    expect(rows[7]).toMatchObject({ status: 'skipped', code: 'PROCESSING_ERROR_REASON_EXPIRED_CLICK' })
    expect(rows[8]).toMatchObject({ status: 'skipped' })
    expect(r.skipped).toBe(2)
  })

  it('sends rows of a request rejected as too recent back to the queue', async () => {
    const db = fakeDb([req('recent')], { recent: [{ id: 3, attempts: 0 }] })
    const dm = {
      retrieveRequestStatus: vi.fn(async () =>
        status('FAILURE', { errorInfo: { errorCounts: [{ reason: 'PROCESSING_ERROR_REASON_TOO_RECENT_CLICK', recordCount: '1' }] } })
      ),
    } as any
    const r = run()
    await pollRequestStatuses({ db, dm, now: NOW, run: r })
    expect(rowUpdates(db)[3]).toMatchObject({ status: 'pending', inc: 1, code: 'PROCESSING_ERROR_REASON_TOO_RECENT_CLICK', nextAt: new Date(NOW.getTime() + 6 * HOUR) })
    expect(r.retrying).toBe(1)
  })

  it('leaves rows of a partly rejected request as uploaded (Google does not say which failed)', async () => {
    const db = fakeDb([req('part')], { part: [{ id: 5, attempts: 0 }] })
    const dm = {
      retrieveRequestStatus: vi.fn(async () =>
        status('PARTIAL_SUCCESS', { errorInfo: { errorCounts: [{ reason: 'PROCESSING_ERROR_REASON_CLICK_NOT_FOUND', recordCount: '1' }] } })
      ),
    } as any
    await pollRequestStatuses({ db, dm, now: NOW, run: run() })
    expect(requestUpdate(db, 'part')!.slice(1, 2)).toEqual(['PARTIAL_SUCCESS'])
    expect(rowUpdates(db)).toEqual({})
  })

  it('gives up on unknown request ids, keeps other read errors on the request, and stops at a credentials problem', async () => {
    const db = fakeDb([req('gone'), req('flaky'), req('other-path'), req('scope'), req('never')])
    const dm = {
      retrieveRequestStatus: vi.fn(async (id: string) => {
        if (id === 'gone') throw new DataManagerApiError('bad id', 400, 'INVALID_ARGUMENT', null, null, [{ field: 'request_id', reason: 'INVALID_REQUEST_ID', description: '' }], false)
        if (id === 'flaky') throw new DataManagerApiError('busy', 503, 'UNAVAILABLE', null, null, [], true)
        // Sent through another access path (e.g. before a reconnect): only this request is affected.
        if (id === 'other-path') throw new DataManagerApiError('denied', 403, 'PERMISSION_DENIED', null, null, [], false)
        throw new DataManagerApiError('Reconnect', 403, 'PERMISSION_DENIED', SCOPE_MISSING, null, [], false)
      }),
    } as any
    const out = await pollRequestStatuses({ db, dm, now: NOW, run: run() })
    expect(out.checked).toBe(0)
    expect(out.blocked?.code).toBe(SCOPE_MISSING)
    expect(dm.retrieveRequestStatus).toHaveBeenCalledTimes(4)
    expect(requestUpdate(db, 'gone')!.slice(1, 2)).toEqual(['UNKNOWN'])
    expect(requestUpdate(db, 'flaky')).toEqual(['flaky', 1, NOW, new Date(NOW.getTime() + 39 * MIN), 'busy'])
    expect(requestUpdate(db, 'other-path')).toEqual(['other-path', 1, NOW, new Date(NOW.getTime() + 39 * MIN), 'denied'])
  })

  it('stops reading on a quota error without blocking the uploads', async () => {
    const db = fakeDb([req('a'), req('b')])
    const dm = {
      retrieveRequestStatus: vi.fn(async () => {
        throw new DataManagerApiError('quota', 429, 'RESOURCE_EXHAUSTED', 'RATE_LIMIT_EXCEEDED', null, [], false, 'IngestionReadRequestsPerDayPerProject')
      }),
    } as any
    expect(await pollRequestStatuses({ db, dm, now: NOW, run: run() })).toEqual({ checked: 0, blocked: null })
    expect(dm.retrieveRequestStatus).toHaveBeenCalledTimes(1)
  })
})

describe('listDataManagerRequests', () => {
  it('maps rows for the tab, and is empty before the table exists', async () => {
    const db = {
      query: vi.fn(async () => ({
        rows: [
          {
            request_id: 'r1',
            kind: 'adjustment',
            event_count: 3,
            status: 'PARTIAL_SUCCESS',
            record_count: 3,
            error_counts: [{ reason: 'PROCESSING_ERROR_REASON_CLICK_NOT_FOUND', count: 1 }],
            warning_counts: [],
            field_warnings: [],
            checks: 2,
            created_at: '2026-10-16T05:00:00Z',
            last_checked_at: '2026-10-16T05:40:00Z',
            finished_at: '2026-10-16T05:40:00Z',
            error: null,
          },
        ],
      })),
    }
    expect(await listDataManagerRequests(20, db)).toEqual([
      {
        requestId: 'r1',
        kind: 'adjustment',
        events: 3,
        status: 'PARTIAL_SUCCESS',
        recordCount: 3,
        errors: [{ reason: 'PROCESSING_ERROR_REASON_CLICK_NOT_FOUND', count: 1 }],
        warnings: [],
        fieldWarnings: [],
        checks: 2,
        createdAt: '2026-10-16T05:00:00.000Z',
        lastCheckedAt: '2026-10-16T05:40:00.000Z',
        finishedAt: '2026-10-16T05:40:00.000Z',
        error: null,
      },
    ])
    const missing = { query: vi.fn(async () => Promise.reject(Object.assign(new Error('no table'), { code: '42P01' }))) }
    expect(await listDataManagerRequests(20, missing)).toEqual([])
  })
})
