import { query } from '@/lib/shared/db'
import { getSiteControls } from '@/lib/catalog/site-controls'
import type { DateRange } from '../queries'
import { readConversionConfig } from './actions'
import { conversionAuth } from './auth'
import type { Db } from './queue'
import {
  CONVERSION_KINDS,
  UPLOAD_STATUSES,
  type ConversionKind,
  type ConversionsSummary,
  type UploadLog,
  type UploadRow,
  type UploadStatus,
} from './types'

// Read side of the Conversions tab: queue counts for the range, the upload log, and retrying failures.

const defaultDb: Db = { query: (text, params) => query(text, params) }
const TZ = 'Asia/Kolkata'

const missingTable = (e: any) => e?.code === '42P01' || e?.code === '42703'

async function browserConversionSet(): Promise<boolean> {
  try {
    const m = (await getSiteControls()).marketing
    return !!(m.googleAdsConversionId && m.googleAdsConversionLabel)
  } catch {
    return false
  }
}

const emptyCounts = (): Record<UploadStatus, number> => ({ pending: 0, uploaded: 0, failed: 0, skipped: 0 })

export async function loadConversionsSummary(range: DateRange, db: Db = defaultDb): Promise<ConversionsSummary> {
  const browserConversion = await browserConversionSet()
  const base: ConversionsSummary = {
    available: false,
    range,
    config: {
      action: null,
      actionName: null,
      owner: null,
      account: null,
      setAt: null,
      connectedCustomer: null,
      matchesAccount: false,
      lastRunAt: null,
      lastRun: null,
      uploadApi: 'data_manager',
    },
    counts: emptyCounts(),
    uploadedValue: 0,
    byKind: [],
    backlog: { pending: 0, failed: 0 },
    browserConversion,
    auth: { connectedVia: null, dataManager: 'unknown' },
  }
  try {
    const config = await readConversionConfig(db)
    const grouped = await db.query(
      `SELECT kind, status, COUNT(*)::int AS n,
              COALESCE(SUM(value) FILTER (WHERE kind = 'purchase' AND status = 'uploaded'), 0) AS uploaded_value
       FROM ads_conversion_uploads
       WHERE (created_at AT TIME ZONE '${TZ}')::date BETWEEN $1::date AND $2::date
       GROUP BY kind, status`,
      [range.from, range.to]
    )
    const backlog = await db.query(
      `SELECT status, COUNT(*)::int AS n FROM ads_conversion_uploads WHERE status IN ('pending', 'failed') GROUP BY status`
    )
    const counts = emptyCounts()
    let uploadedValue = 0
    const byKind: ConversionsSummary['byKind'] = []
    for (const r of grouped.rows) {
      if (!UPLOAD_STATUSES.includes(r.status)) continue
      counts[r.status as UploadStatus] += Number(r.n)
      uploadedValue += Number(r.uploaded_value) || 0
      byKind.push({ kind: r.kind, status: r.status, n: Number(r.n) })
    }
    const b = Object.fromEntries(backlog.rows.map(r => [r.status, Number(r.n)]))
    return {
      ...base,
      available: true,
      config,
      counts,
      uploadedValue: Math.round(uploadedValue * 100) / 100,
      byKind,
      backlog: { pending: b.pending ?? 0, failed: b.failed ?? 0 },
      auth: await conversionAuth(config.lastRun),
    }
  } catch (e) {
    if (missingTable(e)) return base
    throw e
  }
}

export interface LogFilter {
  status?: string | null
  kind?: string | null
  q?: string | null
  page?: number
  pageSize?: number
}

export async function listConversionUploads(f: LogFilter, db: Db = defaultDb): Promise<UploadLog> {
  const pageSize = Math.min(100, Math.max(1, Math.floor(f.pageSize ?? 25)))
  const page = Math.max(1, Math.floor(f.page ?? 1))
  const where: string[] = []
  const params: unknown[] = []
  if (f.status && UPLOAD_STATUSES.includes(f.status as UploadStatus)) {
    params.push(f.status)
    where.push(`u.status = $${params.length}`)
  }
  if (f.kind && CONVERSION_KINDS.includes(f.kind as ConversionKind)) {
    params.push(f.kind)
    where.push(`u.kind = $${params.length}`)
  }
  const q = f.q?.trim()
  if (q) {
    params.push(`%${q.replace(/[%_\\]/g, m => `\\${m}`)}%`)
    where.push(`u.order_number ILIKE $${params.length}`)
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  try {
    const total = (await db.query(`SELECT COUNT(*)::int AS n FROM ads_conversion_uploads u ${clause}`, params)).rows[0]?.n ?? 0
    const rows = (
      await db.query(
        `SELECT u.id, u.order_id, u.order_number, u.kind, u.version, u.value, u.currency_code, u.status, u.attempts,
                u.next_attempt_at, u.error_code, u.error, u.uploaded_at, u.created_at, u.conversion_at,
                CASE WHEN u.gclid IS NOT NULL THEN 'gclid' WHEN u.gbraid IS NOT NULL THEN 'gbraid'
                     WHEN u.wbraid IS NOT NULL THEN 'wbraid' END AS click,
                o.ads_consent, u.request_id, r.status AS request_status, r.error_counts AS request_errors,
                r.event_count AS request_events
         FROM ads_conversion_uploads u LEFT JOIN orders o ON o.id = u.order_id
           LEFT JOIN ads_conversion_requests r ON r.request_id = u.request_id
         ${clause}
         ORDER BY u.created_at DESC, u.id DESC
         LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
        params
      )
    ).rows
    return {
      rows: rows.map(
        (r): UploadRow => ({
          ...r,
          id: Number(r.id),
          version: Number(r.version),
          value: Number(r.value),
          attempts: Number(r.attempts),
          next_attempt_at: r.next_attempt_at ? new Date(r.next_attempt_at).toISOString() : null,
          uploaded_at: r.uploaded_at ? new Date(r.uploaded_at).toISOString() : null,
          created_at: new Date(r.created_at).toISOString(),
          conversion_at: new Date(r.conversion_at).toISOString(),
          ads_consent: r.ads_consent ?? null,
          request_id: r.request_id ?? null,
          request_status: r.request_status ?? null,
          request_errors: Array.isArray(r.request_errors) ? r.request_errors : null,
          request_events: r.request_events == null ? null : Number(r.request_events),
        })
      ),
      total: Number(total),
      page,
      pageSize,
    }
  } catch (e) {
    if (missingTable(e)) return { rows: [], total: 0, page, pageSize }
    throw e
  }
}

/** Put failed rows back in the queue with a fresh attempt budget (all of them, or the given ids). */
export async function retryFailedUploads(ids: number[] | null, db: Db = defaultDb): Promise<number> {
  const only = ids?.length ? ids.filter(n => Number.isSafeInteger(n) && n > 0) : null
  if (ids?.length && !only?.length) return 0
  const r = await db.query(
    `UPDATE ads_conversion_uploads SET status = 'pending', attempts = 0, next_attempt_at = now(),
       error = NULL, error_code = NULL, updated_at = now()
     WHERE status = 'failed'${only ? ' AND id = ANY($1::bigint[])' : ''}
     RETURNING id`,
    only ? [only] : []
  )
  return r.rowCount ?? r.rows.length
}
