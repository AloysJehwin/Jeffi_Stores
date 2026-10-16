import type { Db } from './queue'
import { MAX_ATTEMPTS, backoffMs, type Classified } from './rules'
import type { ConversionKind, UploadRunSummary, UploadStatus } from './types'

// Queue row shape for the upload job and the batched status writes both upload paths share.

export interface DueRow {
  id: number
  order_id: string
  order_number: string
  kind: ConversionKind
  version: number
  value: number | string
  currency_code: string
  gclid: string | null
  gbraid: string | null
  wbraid: string | null
  click_at: Date | string | null
  conversion_at: Date | string
  adjustment_at: Date | string | null
  status: UploadStatus
  attempts: number
  conversion_action: string | null
  uploaded_at: Date | string | null
  request_id?: string | null
  /** Status of request_id's Data Manager request (joined). */
  request_status?: string | null
  customer_email?: string | null
  customer_phone?: string | null
  ads_consent?: boolean | null
}

export interface Update {
  id: number
  status: UploadStatus
  inc: number
  code: string | null
  error: string | null
  nextAt: Date | null
  value: number | null
  action: string | null
  jobId: string | null
  requestId: string | null
}

/** One UPDATE for many rows. uploaded_at is stamped when a row becomes uploaded, not on later notes. */
export async function applyUpdates(db: Db, updates: Update[], now: Date): Promise<void> {
  if (!updates.length) return
  await db.query(
    `UPDATE ads_conversion_uploads u SET
       status = v.status, attempts = u.attempts + v.inc, error_code = v.code, error = v.error,
       next_attempt_at = COALESCE(v.next_at, u.next_attempt_at),
       uploaded_at = CASE WHEN v.status = 'uploaded' AND u.status <> 'uploaded' THEN $11::timestamptz ELSE u.uploaded_at END,
       value = COALESCE(v.value, u.value), conversion_action = COALESCE(v.action, u.conversion_action),
       job_id = COALESCE(v.job_id, u.job_id), request_id = COALESCE(v.request_id, u.request_id), updated_at = now()
     FROM unnest($1::bigint[], $2::text[], $3::int[], $4::text[], $5::text[], $6::timestamptz[], $7::numeric[], $8::text[], $9::bigint[], $10::text[])
       AS v(id, status, inc, code, error, next_at, value, action, job_id, request_id)
     WHERE u.id = v.id`,
    [
      updates.map(u => u.id),
      updates.map(u => u.status),
      updates.map(u => u.inc),
      updates.map(u => u.code),
      updates.map(u => u.error),
      updates.map(u => u.nextAt),
      updates.map(u => u.value),
      updates.map(u => u.action),
      updates.map(u => u.jobId),
      updates.map(u => u.requestId),
      now,
    ]
  )
}

const blank = { nextAt: null, value: null, action: null, jobId: null, requestId: null }

export const skip = (id: number, code: string, error: string): Update => ({ id, status: 'skipped', inc: 0, code, error, ...blank })

/** Next state of a row after a failed attempt: retry with backoff, or failed once attempts run out. */
export function afterFailure(row: Pick<DueRow, 'id' | 'attempts'>, c: Classified, now: Date): Update {
  const attempts = row.attempts + 1
  const base = { id: row.id, inc: 1, code: null as string | null, error: c.message, ...blank }
  if (c.outcome === 'retry' && attempts < MAX_ATTEMPTS) {
    return { ...base, status: 'pending', nextAt: new Date(now.getTime() + Math.max(c.delayMs, backoffMs(attempts))) }
  }
  return { ...base, status: 'failed', nextAt: null }
}

/** A classified outcome as an update: already in Google counts as uploaded, the rest skip / retry / fail. */
export function outcomeUpdate(row: Pick<DueRow, 'id' | 'attempts'>, c: Classified, code: string | null, now: Date): Update {
  if (c.outcome === 'uploaded') return { id: row.id, status: 'uploaded', inc: 0, code, error: c.message, ...blank }
  if (c.outcome === 'skipped') return skip(row.id, code ?? 'SKIPPED', c.message)
  return { ...afterFailure(row, c, now), code }
}

export function tally(run: UploadRunSummary, updates: Update[]) {
  for (const u of updates) {
    if (u.status === 'uploaded') run.uploaded++
    else if (u.status === 'failed') run.failed++
    else if (u.status === 'skipped') run.skipped++
    else run.retrying++
  }
}
