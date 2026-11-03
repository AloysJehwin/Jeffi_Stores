// Period maths for the reviews overview. Dates are IST business days as YYYY-MM-DD.

export type PeriodPreset = '7d' | '30d' | 'month' | 'last_month' | '90d' | 'fy'
export interface Period {
  from: string
  to: string
}

export const PERIOD_PRESETS: { id: PeriodPreset; label: string }[] = [
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

export function isDate(v: string | null | undefined): v is string {
  return !!v && DATE_RE.test(v) && fmt(toUtc(v)) === v
}

export function presetRange(id: PeriodPreset, today: string): Period {
  const y = +today.slice(0, 4)
  const m = +today.slice(5, 7)
  switch (id) {
    case '7d':
      return { from: addDays(today, -6), to: today }
    case '90d':
      return { from: addDays(today, -89), to: today }
    case 'month':
      return { from: today.slice(0, 8) + '01', to: today }
    case 'last_month': {
      const first = fmt(Date.UTC(y, m - 2, 1))
      return { from: first, to: fmt(Date.UTC(y, m - 1, 0)) }
    }
    case 'fy':
      return { from: `${m >= 4 ? y : y - 1}-04-01`, to: today }
    default:
      return { from: addDays(today, -29), to: today }
  }
}

export function matchPreset(p: Period, today: string): PeriodPreset | null {
  return PERIOD_PRESETS.find(x => {
    const r = presetRange(x.id, today)
    return r.from === p.from && r.to === p.to
  })?.id ?? null
}

/** The equal-length period that ends the day before `p` starts. */
export function previousPeriod(p: Period): Period {
  const n = spanDays(p)
  return { from: addDays(p.from, -n), to: addDays(p.from, -1) }
}

/** Valid ?from&to, else the 30-day default. Clamps `to` to today and the span to MAX_SPAN_DAYS. */
export function parsePeriod(from: string | null | undefined, to: string | null | undefined, today: string): Period {
  if (!isDate(from) || !isDate(to) || from > to) return presetRange('30d', today)
  const end = to > today ? today : to
  if (from > end) return presetRange('30d', today)
  const p = { from, to: end }
  return spanDays(p) > MAX_SPAN_DAYS ? { from: addDays(end, -(MAX_SPAN_DAYS - 1)), to: end } : p
}

/** Today as an IST YYYY-MM-DD. */
export const istToday = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now)

/** Running average rating across the period; days before the first review take the first value. */
export function runningAverage(days: { reviews: number; avgRating: number | null }[]): (number | null)[] {
  let sum = 0
  let cnt = 0
  const out: (number | null)[] = days.map(d => {
    if (d.reviews > 0 && d.avgRating != null) {
      sum += d.avgRating * d.reviews
      cnt += d.reviews
    }
    return cnt ? Math.round((sum / cnt) * 100) / 100 : null
  })
  const first = out.find(v => v != null) ?? null
  return out.map(v => v ?? first)
}
