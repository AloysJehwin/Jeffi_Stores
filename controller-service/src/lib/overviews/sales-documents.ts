import { bucketFor, previousPeriod, type Bucket, type Period } from '@/lib/overview/period'

// SQL fragments shared by the sales-document overviews (invoices, quotations, cash sale,
// subscriptions). Every query takes the same args: $1 previous start, $2 current start, $3 current end.

export const BOUNDS = `b AS (
  SELECT ($1::date)::timestamp AT TIME ZONE 'Asia/Kolkata' AS p0,
         ($2::date)::timestamp AT TIME ZONE 'Asia/Kolkata' AS c0,
         ($3::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata' AS c1)`

export const TODAY_IST = `(now() AT TIME ZONE 'Asia/Kolkata')::date`
export const istDay = (col: string) => `(${col} AT TIME ZONE 'Asia/Kolkata')::date`

const SERIES_START: Record<Bucket, string> = {
  day: '$2::date::timestamp',
  week: "date_trunc('week', $2::date::timestamp)",
  month: "date_trunc('month', $2::date::timestamp)",
}

/** CTE `k(bucket)` covering the current period; join rows with `inBucket`. */
export const bucketsCte = (bucket: Bucket) =>
  `k AS (SELECT generate_series(${SERIES_START[bucket]}, $3::date::timestamp, INTERVAL '1 ${bucket}') AS bucket)`
export const inBucket = (col: string, bucket: Bucket) =>
  `date_trunc('${bucket}', ${col} AT TIME ZONE 'Asia/Kolkata') = k.bucket`

export function periodArgs(period: Period) {
  const previous = previousPeriod(period)
  return { previous, bucket: bucketFor(period), args: [previous.from, period.from, period.to] }
}

export type Row = Record<string, unknown>
export const num = (v: unknown) => (v == null ? 0 : Number(v) || 0)
export const numOrNull = (v: unknown) => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null)
export const str = (v: unknown, fallback = '') => (v == null ? fallback : String(v))

/** Rows tagged `period` = 'cur' | 'prev' into { current, previous }. */
export function byPeriod<T>(
  rows: Row[] | null | undefined,
  map: (r: Row | undefined) => T
): { current: T; previous: T } {
  return { current: map(rows?.find(r => r.period === 'cur')), previous: map(rows?.find(r => r.period === 'prev')) }
}

/** `{ key, label }` buckets filled from grouped rows (missing keys are zero). */
export function fillKeyed<K extends string>(
  keys: readonly { key: K; label: string }[],
  rows: Row[],
  col = 'bucket'
): { key: K; label: string; count: number; amount: number }[] {
  return keys.map(({ key, label }) => {
    const r = rows.find(x => x[col] === key)
    return { key, label, count: num(r?.n), amount: num(r?.amount) }
  })
}

export type OverviewTab = 'overview' | 'list' | 'drafts'

/** Which tab a page opens on: ?tab wins; old list links (any of `listKeys` present) open the list. */
export function resolveOverviewTab(
  sp: { get(k: string): string | null; has(k: string): boolean },
  listKeys: readonly string[]
): OverviewTab {
  const t = sp.get('tab')
  if (t === 'overview' || t === 'list' || t === 'drafts') return t
  return listKeys.some(k => sp.has(k)) ? 'list' : 'overview'
}
