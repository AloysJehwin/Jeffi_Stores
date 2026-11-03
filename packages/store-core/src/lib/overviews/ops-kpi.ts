// Shared pieces for the B2B and operations overviews (RFQs, B2B customers, suppliers, tasks,
// shelving, team, audit, agent). Pure: safe to import from client components.
import { delta, istRangeSql, previousPeriod, type Bucket, type Period } from '@/lib/overview/period'

export type KpiFormat = 'count' | 'money' | 'pct' | 'hours' | 'days'

export interface OverviewKpi {
  key: string
  label: string
  value: number | null
  previous: number | null
  delta: number | null
  format: KpiFormat
  /** Lower is better (overdue, failures, response time). */
  invert?: boolean
  sub?: string
}

export function kpi(
  key: string,
  label: string,
  value: number | null,
  previous: number | null,
  format: KpiFormat,
  opts: { invert?: boolean; sub?: string } = {}
): OverviewKpi {
  return { key, label, value, previous, delta: delta(value, previous), format, ...opts }
}

/** A snapshot figure with no previous period. */
export const snapshot = (
  key: string,
  label: string,
  value: number | null,
  format: KpiFormat,
  opts: { invert?: boolean; sub?: string } = {}
) => ({ key, label, value, previous: null, delta: null, format, ...opts }) as OverviewKpi

export const n = (v: unknown) => (v == null ? 0 : Number(v) || 0)
export const nn = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v))

export function formatKpi(v: number | null, f: KpiFormat): string {
  if (v == null || !Number.isFinite(v)) return '-'
  switch (f) {
    case 'money':
      return Math.abs(v) < 100 && !Number.isInteger(v)
        ? `Rs ${v.toFixed(2)}`
        : `Rs ${Math.round(v).toLocaleString('en-IN')}`
    case 'pct':
      return `${(v * 100).toFixed(1)}%`
    case 'hours':
      return v < 1 ? `${Math.round(v * 60)} min` : v < 48 ? `${v.toFixed(1)} h` : `${(v / 24).toFixed(1)} d`
    case 'days':
      return `${v.toFixed(1)} d`
    default:
      return Math.round(v).toLocaleString('en-IN')
  }
}

/** Current period at $1/$2 and previous at $3/$4. */
export function periodSql(p: Period) {
  const prev = previousPeriod(p)
  return {
    previous: prev,
    params: [p.from, p.to, prev.from, prev.to] as string[],
    cur: (col: string) => istRangeSql(col, p, 1).sql,
    prev: (col: string) => istRangeSql(col, prev, 3).sql,
    /** Either period (uses all four params). */
    span: (col: string) => `((${istRangeSql(col, p, 1).sql}) OR (${istRangeSql(col, prev, 3).sql}))`,
  }
}

/** Bucket starts (YYYY-MM-DD) for the current period at $1/$2; join on `(col AT TIME ZONE IST)::date`. */
export const bucketSeriesSql = (b: Bucket) =>
  `SELECT g::date AS b FROM generate_series(date_trunc('${b}', $1::date::timestamp), $2::date::timestamp, interval '1 ${b}') g`

/** `expr` truncated to the bucket as an IST date. */
export const bucketOf = (expr: string, b: Bucket) => `date_trunc('${b}', (${expr} AT TIME ZONE 'Asia/Kolkata'))::date`

export const hoursBetween = (from: string | Date | null | undefined, now = new Date()) =>
  from == null ? null : Math.max(0, (now.getTime() - new Date(from).getTime()) / 3_600_000)

export const plural = (k: number, one: string, many = `${one}s`) =>
  `${k.toLocaleString('en-IN')} ${k === 1 ? one : many}`
