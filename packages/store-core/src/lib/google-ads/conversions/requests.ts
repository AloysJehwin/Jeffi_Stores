import { query } from '@/lib/shared/db'
import { DataManagerApiError, type DataManagerClient, type FieldWarning, type ReasonCountRaw } from './data-manager'
import type { Db } from './queue'
import { applyUpdates, outcomeUpdate, tally, type DueRow } from './rows'
import {
  CREDENTIAL_CODES,
  POLL_FIRST_MIN,
  classifyProcessingError,
  describeReasonCounts,
  nextPollDelayMs,
  type Classified,
} from './rules'
import type { DataManagerRequest, ReasonCount, RequestStatus, UploadRunSummary } from './types'

// Data Manager requests of the upload job and Google's verdict on each: requestStatus:retrieve from
// 30 minutes after the request, backing off to hourly, for 24 hours. Google reports error counts
// per request, not per event, so a FAILED request (every event rejected) is mapped back onto its
// rows; a PARTIAL_SUCCESS one only shows its counts.

const defaultDb: Db = { query: (text, params) => query(text, params) }
const MIN = 60_000
const WINDOW_MS = 24 * 60 * MIN
export const POLLS_PER_RUN = 25

export async function recordRequest(
  db: Db,
  r: { requestId: string; kind: 'purchase' | 'adjustment'; events: number; fieldWarnings?: FieldWarning[]; now: Date }
): Promise<void> {
  await db.query(
    `INSERT INTO ads_conversion_requests (request_id, kind, event_count, field_warnings, next_check_at, created_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)
     ON CONFLICT (request_id) DO NOTHING`,
    [r.requestId, r.kind, r.events, JSON.stringify(r.fieldWarnings ?? []), new Date(r.now.getTime() + POLL_FIRST_MIN * MIN), r.now]
  )
}

const counts = (list: ReasonCountRaw[] | undefined): ReasonCount[] =>
  (Array.isArray(list) ? list : []).map(c => ({ reason: String(c?.reason ?? 'UNKNOWN'), count: Number(c?.recordCount) || 0 }))

const TERMINAL = new Set<RequestStatus>(['SUCCESS', 'PARTIAL_SUCCESS', 'FAILED'])

/** Google's enum (the guide says FAILURE, the reference FAILED) as ours; anything else still processing. */
export function normalizeRequestStatus(s: unknown): RequestStatus {
  const v = String(s ?? '')
  if (v === 'FAILURE' || v === 'FAILED') return 'FAILED'
  if (v === 'SUCCESS' || v === 'PARTIAL_SUCCESS') return v
  return 'PROCESSING'
}

/**
 * Rows of a request every event of which Google rejected: one reason (or reasons with the same
 * handling) applies to all of them; mixed reasons fail them for a manual retry.
 */
export function failedRequestOutcome(errors: ReasonCount[]): { c: Classified; code: string } {
  const classified = errors.map(e => ({ ...e, c: classifyProcessingError(e.reason) }))
  const outcomes = new Set(classified.map(x => x.c.outcome))
  if (classified.length === 1) return { c: classified[0].c, code: classified[0].reason }
  if (classified.length > 1 && outcomes.size === 1) {
    const c = classified[0].c
    return { c: { ...c, message: `Google rejected the upload: ${describeReasonCounts(errors)}.` }, code: 'PROCESSING_FAILED' }
  }
  const message = errors.length
    ? `Google rejected every event of this upload: ${describeReasonCounts(errors)}.`
    : 'Google rejected every event of this upload without a reason.'
  return { c: { outcome: 'failed', delayMs: 0, message }, code: 'PROCESSING_FAILED' }
}

async function applyFailed(db: Db, requestId: string, errors: ReasonCount[], now: Date, run: UploadRunSummary): Promise<void> {
  const rows = (
    await db.query(`SELECT id, attempts FROM ads_conversion_uploads WHERE request_id = $1 AND status = 'uploaded'`, [requestId])
  ).rows as Pick<DueRow, 'id' | 'attempts'>[]
  if (!rows.length) return
  const { c, code } = failedRequestOutcome(errors)
  const updates = rows.map(r => outcomeUpdate({ id: Number(r.id), attempts: Number(r.attempts) || 0 }, c, code, now))
  await applyUpdates(db, updates, now)
  tally(run, updates.filter(u => u.status !== 'uploaded'))
}

/**
 * Reads the status of requests that are due. A credentials problem stops the run (returned); a
 * quota error stops reading for now; anything else (a request sent through another access path
 * answers PERMISSION_DENIED) stays on that request and is read again later, for up to a day.
 */
export async function pollRequestStatuses(ctx: {
  db: Db
  dm: DataManagerClient
  now: Date
  run: UploadRunSummary
  limit?: number
}): Promise<{ checked: number; blocked: DataManagerApiError | null }> {
  const { db, dm, now, run } = ctx
  const due = (
    await db.query(
      `SELECT request_id, kind, checks, created_at FROM ads_conversion_requests
       WHERE finished_at IS NULL AND next_check_at <= $1 ORDER BY next_check_at LIMIT $2`,
      [now, ctx.limit ?? POLLS_PER_RUN]
    )
  ).rows as { request_id: string; kind: string; checks: number; created_at: Date | string }[]
  let checked = 0
  for (const r of due) {
    const checks = Number(r.checks) + 1
    const expired = now.getTime() - new Date(r.created_at).getTime() >= WINDOW_MS
    let res
    try {
      res = await dm.retrieveRequestStatus(r.request_id)
    } catch (e) {
      const err = e instanceof DataManagerApiError ? e : null
      const message = String((e as Error)?.message ?? e).slice(0, 500)
      if (err && (err.code === 'INVALID_REQUEST_ID' || err.code === 'REQUEST_TOO_OLD' || err.status === 'NOT_FOUND')) {
        await finishRequest(db, r.request_id, 'UNKNOWN', checks, now, message)
        continue
      }
      if (expired) await finishRequest(db, r.request_id, 'TIMED_OUT', checks, now, message)
      else {
        await db.query(
          `UPDATE ads_conversion_requests SET checks = $2, last_checked_at = $3, next_check_at = $4, error = $5 WHERE request_id = $1`,
          [r.request_id, checks, now, new Date(now.getTime() + nextPollDelayMs(checks)), message]
        )
      }
      if (err && (CREDENTIAL_CODES.has(err.code) || (!!err.reason && CREDENTIAL_CODES.has(err.reason)))) return { checked, blocked: err }
      if (err?.status === 'RESOURCE_EXHAUSTED') break
      continue
    }
    checked++
    const d = res?.requestStatusPerDestination?.[0] ?? {}
    const status = normalizeRequestStatus(d.requestStatus)
    const errors = counts(d.errorInfo?.errorCounts)
    const warnings = counts(d.warningInfo?.warningCounts)
    const recordCount = d.eventsIngestionStatus?.recordCount == null ? null : Number(d.eventsIngestionStatus.recordCount)
    const terminal = TERMINAL.has(status)
    const final: RequestStatus = terminal ? status : expired ? 'TIMED_OUT' : 'PROCESSING'
    await db.query(
      `UPDATE ads_conversion_requests SET status = $2, record_count = $3, error_counts = $4::jsonb, warning_counts = $5::jsonb,
         checks = $6, last_checked_at = $7, next_check_at = $8, finished_at = $9, error = NULL
       WHERE request_id = $1`,
      [
        r.request_id,
        final,
        recordCount,
        JSON.stringify(errors),
        JSON.stringify(warnings),
        checks,
        now,
        new Date(now.getTime() + nextPollDelayMs(checks)),
        terminal || expired ? now : null,
      ]
    )
    if (status === 'FAILED') await applyFailed(db, r.request_id, errors, now, run)
  }
  return { checked, blocked: null }
}

async function finishRequest(db: Db, requestId: string, status: RequestStatus, checks: number, now: Date, error: string) {
  await db.query(
    `UPDATE ads_conversion_requests SET status = $2, checks = $3, last_checked_at = $4, finished_at = $4, error = $5 WHERE request_id = $1`,
    [requestId, status, checks, now, error]
  )
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null)
const list = (v: unknown) => (Array.isArray(v) ? v : [])

/** The latest requests for the Conversions tab. */
export async function listDataManagerRequests(limit = 20, db: Db = defaultDb): Promise<DataManagerRequest[]> {
  try {
    const rows = (
      await db.query(
        `SELECT request_id, kind, event_count, status, record_count, error_counts, warning_counts, field_warnings,
                checks, created_at, last_checked_at, finished_at, error
         FROM ads_conversion_requests ORDER BY created_at DESC LIMIT $1`,
        [Math.min(100, Math.max(1, Math.floor(limit)))]
      )
    ).rows
    return rows.map(r => ({
      requestId: String(r.request_id),
      kind: r.kind,
      events: Number(r.event_count),
      status: r.status,
      recordCount: r.record_count == null ? null : Number(r.record_count),
      errors: list(r.error_counts),
      warnings: list(r.warning_counts),
      fieldWarnings: list(r.field_warnings),
      checks: Number(r.checks),
      createdAt: iso(r.created_at)!,
      lastCheckedAt: iso(r.last_checked_at),
      finishedAt: iso(r.finished_at),
      error: r.error ?? null,
    }))
  } catch (e: any) {
    if (e?.code === '42P01' || e?.code === '42703') return []
    throw e
  }
}
