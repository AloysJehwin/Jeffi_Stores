// Client-safe period helpers for the CRM overview. Dates are IST business days (YYYY-MM-DD).
import type { AnalyticsRange } from '@/lib/queries/shared'

export type PeriodPreset = '7d' | '30d' | 'this_month' | 'last_month' | '90d' | 'fy'
export interface Period {
  from: string
  to: string
}
export type Bucket = 'day' | 'week' | 'month'

export const PERIOD_PRESETS: { key: PeriodPreset; label: string }[] = [
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: '90d', label: '90 days' },
  { key: 'fy', label: 'This FY' },
]

const ISO = /^\d{4}-\d{2}-\d{2}$/
const MAX_DAYS = 731

export function istToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now)
}

const toUtc = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))
const fromUtc = (t: number) => new Date(t).toISOString().slice(0, 10)

export const addDays = (iso: string, n: number) => fromUtc(toUtc(iso) + n * 86_400_000)
export const spanDays = (p: Period) => Math.round((toUtc(p.to) - toUtc(p.from)) / 86_400_000) + 1

export function isValidIso(s: string | null | undefined): s is string {
  if (!s || !ISO.test(s)) return false
  return fromUtc(toUtc(s)) === s
}

export function presetPeriod(key: PeriodPreset, today: string): Period {
  const y = +today.slice(0, 4)
  const m = +today.slice(5, 7)
  switch (key) {
    case '7d':
      return { from: addDays(today, -6), to: today }
    case '90d':
      return { from: addDays(today, -89), to: today }
    case 'this_month':
      return { from: `${today.slice(0, 7)}-01`, to: today }
    case 'last_month': {
      const firstThis = fromUtc(Date.UTC(y, m - 1, 1))
      const lastPrev = addDays(firstThis, -1)
      return { from: `${lastPrev.slice(0, 7)}-01`, to: lastPrev }
    }
    case 'fy':
      return { from: `${m >= 4 ? y : y - 1}-04-01`, to: today }
    default:
      return { from: addDays(today, -29), to: today }
  }
}

export function matchPreset(p: Period, today: string): PeriodPreset | null {
  return PERIOD_PRESETS.find(({ key }) => {
    const q = presetPeriod(key, today)
    return q.from === p.from && q.to === p.to
  })?.key ?? null
}

/** Equal-length window ending the day before `p.from`. */
export function previousPeriod(p: Period): Period {
  const len = spanDays(p)
  return { from: addDays(p.from, -len), to: addDays(p.from, -1) }
}

export function parsePeriod(from: string | null | undefined, to: string | null | undefined, today: string): Period {
  if (isValidIso(from) && isValidIso(to) && from <= to) {
    const p = { from, to }
    if (spanDays(p) <= MAX_DAYS) return p
  }
  return presetPeriod('30d', today)
}

export function bucketFor(p: Period): Bucket {
  const d = spanDays(p)
  return d <= 45 ? 'day' : d <= 180 ? 'week' : 'month'
}

/** Range for the older range-based insight cards, when a preset maps onto one. */
export function insightsRangeFor(key: PeriodPreset | null): AnalyticsRange | null {
  switch (key) {
    case '7d':
      return '7d'
    case '30d':
      return '30d'
    case '90d':
      return '90d'
    case 'this_month':
      return 'month'
    default:
      return null
  }
}

export function periodLabel(p: Period): string {
  const f = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  return p.from === p.to ? f(p.from) : `${f(p.from)} to ${f(p.to)}`
}
