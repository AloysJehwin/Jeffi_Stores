// Shared period maths for every admin overview. Dates are IST business days as YYYY-MM-DD; the
// comparison period is the equal-length span that ends the day before the current one starts.

export type PeriodPreset = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'last_month' | '90d' | 'fy'

export interface Period {
  from: string
  to: string
}

export const PERIOD_PRESETS: { id: PeriodPreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: '90d', label: '90 days' },
  { id: 'fy', label: 'This FY' },
]

const DAY = 86_400_000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export const MAX_SPAN_DAYS = 400

const toUtc = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))
const fmt = (t: number) => new Date(t).toISOString().slice(0, 10)
export const addDays = (d: string, n: number) => fmt(toUtc(d) + n * DAY)
export const spanDays = (p: Period) => Math.round((toUtc(p.to) - toUtc(p.from)) / DAY) + 1

export const istToday = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now)

export function isDate(v: string | null | undefined): v is string {
  return !!v && DATE_RE.test(v) && fmt(toUtc(v)) === v
}

export function presetRange(id: PeriodPreset, today = istToday()): Period {
  const y = +today.slice(0, 4)
  const m = +today.slice(5, 7)
  switch (id) {
    case 'today':
      return { from: today, to: today }
    case 'yesterday': {
      const d = addDays(today, -1)
      return { from: d, to: d }
    }
    case '7d':
      return { from: addDays(today, -6), to: today }
    case '90d':
      return { from: addDays(today, -89), to: today }
    case 'month':
      return { from: today.slice(0, 8) + '01', to: today }
    case 'last_month':
      return { from: fmt(Date.UTC(y, m - 2, 1)), to: fmt(Date.UTC(y, m - 1, 0)) }
    case 'fy':
      return { from: `${m >= 4 ? y : y - 1}-04-01`, to: today }
    default:
      return { from: addDays(today, -29), to: today }
  }
}

export function matchPreset(p: Period, today = istToday()): PeriodPreset | null {
  return PERIOD_PRESETS.find(x => {
    const r = presetRange(x.id, today)
    return r.from === p.from && r.to === p.to
  })?.id ?? null
}

export function previousPeriod(p: Period): Period {
  const n = spanDays(p)
  return { from: addDays(p.from, -n), to: addDays(p.from, -1) }
}

/** Valid ?from&to, else the default preset. `to` is clamped to today and the span to MAX_SPAN_DAYS. */
export function parsePeriod(from: string | null | undefined, to: string | null | undefined, today = istToday(), fallback: PeriodPreset = '30d'): Period {
  if (!isDate(from) || !isDate(to) || from > to) return presetRange(fallback, today)
  const end = to > today ? today : to
  if (from > end) return presetRange(fallback, today)
  const p = { from, to: end }
  return spanDays(p) > MAX_SPAN_DAYS ? { from: addDays(end, -(MAX_SPAN_DAYS - 1)), to: end } : p
}

export type Bucket = 'day' | 'week' | 'month'

/** Chart granularity: daily up to 45 days, weekly up to 200, then monthly. */
export function bucketFor(p: Period): Bucket {
  const n = spanDays(p)
  return n <= 45 ? 'day' : n <= 200 ? 'week' : 'month'
}

/** SQL for a timestamptz column inside the period as IST days: `${col} >= $a AND ${col} < $b`,
 * with the bound values. Use the returned params at positions start..start+1. */
export function istRangeSql(col: string, p: Period, start: number): { sql: string; params: string[] } {
  return {
    sql: `${col} >= ($${start}::date)::timestamp AT TIME ZONE 'Asia/Kolkata' AND ${col} < ($${start + 1}::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'`,
    params: [p.from, p.to],
  }
}

/** Relative change, null when the base is zero. */
export const delta = (cur: number | null | undefined, prev: number | null | undefined) =>
  cur == null || prev == null || !prev ? null : (cur - prev) / Math.abs(prev)

/** Safe ratio, null when the denominator is zero. */
export const ratio = (a: number | null | undefined, b: number | null | undefined) => (a == null || !b ? null : a / b)
