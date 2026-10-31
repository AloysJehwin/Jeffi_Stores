import { addDays, parsePeriod, previousPeriod, spanDays, type Period } from '@/lib/overview/period'
import { istDate } from '@/lib/channels/report-store'

// Traffic report periods: IST days (shared overview maths) plus the trend bucket and query bounds.

export type { Period }
export { previousPeriod, spanDays }

export type TrendBucket = 'day' | 'week'

/** ?from&to on IST days, defaulting to the last 30 days. */
export function trafficPeriod(from: string | null, to: string | null, now = new Date()): Period {
  return parsePeriod(from, to, istDate(now), '30d')
}

/** Daily trend up to 60 days, weekly beyond. */
export const trendBucket = (p: Period): TrendBucket => (spanDays(p) > 60 ? 'week' : 'day')

/** Timestamptz bounds [start, end) for the period's IST days. */
export function istBounds(p: Period): [string, string] {
  return [`${p.from}T00:00:00+05:30`, `${addDays(p.to, 1)}T00:00:00+05:30`]
}

/** Monday of the week containing an IST date (matches Postgres date_trunc('week')). */
export function weekStart(d: string): string {
  const dow = new Date(`${d}T00:00:00Z`).getUTCDay()
  return addDays(d, -((dow + 6) % 7))
}

/** Every bucket key in the period, oldest first. */
export function bucketKeys(p: Period, bucket: TrendBucket): string[] {
  const out: string[] = []
  const step = bucket === 'week' ? 7 : 1
  for (let d = bucket === 'week' ? weekStart(p.from) : p.from; d <= p.to; d = addDays(d, step)) out.push(d)
  return out
}

/** Rows keyed by bucket, filled with zeros for missing buckets. */
export function fillSeries<T extends { bucket: string }>(keys: string[], rows: T[], blank: (bucket: string) => T): T[] {
  const by = new Map(rows.map(r => [r.bucket, r]))
  return keys.map(k => by.get(k) ?? blank(k))
}
