// Shape and maths of a page's insights series (the 3D pop-over), shared by the server helper and the drawer.

export interface InsightsSeriesDef {
  key: string
  label: string
}

export interface InsightsDay {
  date: string // YYYY-MM-DD, store-local day
  values: number[] // one per series, in `series` order; the day's total is their sum
  /** Tooltip breakdown, largest first (e.g. top categories); without it the tooltip splits by series. */
  top?: { name: string; count: number }[]
  /** Last tooltip line, e.g. "12 customers". */
  note?: string
}

export interface InsightsTotals {
  total: number
  busiestDay: { date: string; count: number } | null
  longestStreak: number // consecutive days with a non-zero total
  currentStreak: number // ending today, or yesterday while today is still zero
}

export interface InsightsSeries<E = unknown> {
  weeks: number
  filter: string | null
  from: string // Monday of the first week
  to: string // Sunday of the last week (future days are zero)
  today: string
  series: InsightsSeriesDef[]
  days: InsightsDay[] // weeks * 7, Monday-aligned, oldest first
  totals: InsightsTotals
  /** Page-specific payload for custom sections. */
  extra?: E
}

export interface InsightsQuery {
  weeks: number
  filter: string | null
}

export const INSIGHTS_PERIODS = [13, 26, 52]
export const INSIGHTS_WEEKS_MAX = 52

/** `weeks` (default 26) and `filter` (default the first allowed value) from a series route's query, checked against what it allows. */
export function parseInsightsQuery(
  sp: URLSearchParams,
  filters?: readonly string[],
  periods: readonly number[] = INSIGHTS_PERIODS
): { ok: true; weeks: number; filter: string | null } | { ok: false; error: string } {
  const weeks = sp.has('weeks') ? Number(sp.get('weeks')) : periods.includes(26) ? 26 : periods[0]
  if (!periods.includes(weeks)) return { ok: false, error: `weeks must be one of ${periods.join(', ')}` }
  if (!filters?.length) return { ok: true, weeks, filter: null }
  const filter = sp.get('filter') ?? filters[0]
  if (!filters.includes(filter)) return { ok: false, error: `filter must be one of ${filters.join(', ')}` }
  return { ok: true, weeks, filter }
}

const DAY_MS = 86_400_000
const parseDay = (s: string) => Date.parse(`${s}T00:00:00Z`)
const fmtDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export const dayTotal = (d: InsightsDay) => d.values.reduce((s, v) => s + v, 0)

/** `weeks` Monday-aligned weeks ending with the week that holds `today`. */
export function mondayGrid(today: string, weeks: number): { from: string; to: string; dates: string[] } {
  const t = parseDay(today)
  const monday = t - ((new Date(t).getUTCDay() + 6) % 7) * DAY_MS
  const fromMs = monday - (weeks - 1) * 7 * DAY_MS
  const dates = Array.from({ length: weeks * 7 }, (_, i) => fmtDay(fromMs + i * DAY_MS))
  return { from: dates[0], to: dates[dates.length - 1], dates }
}

export function summarize(days: InsightsDay[], today: string): InsightsTotals {
  let busiest: InsightsTotals['busiestDay'] = null
  let longest = 0
  let run = 0
  let total = 0
  const totals = days.map(dayTotal)
  totals.forEach((n, i) => {
    total += n
    if (n > (busiest?.count ?? 0)) busiest = { date: days[i].date, count: n }
    run = n > 0 ? run + 1 : 0
    longest = Math.max(longest, run)
  })
  const todayIdx = days.findIndex(d => d.date === today)
  let current = 0
  if (todayIdx >= 0) for (let i = todayIdx - (totals[todayIdx] ? 0 : 1); i >= 0 && totals[i] > 0; i--) current++
  return { total, busiestDay: busiest, longestStreak: longest, currentStreak: current }
}

/** Per-week sums of each series, oldest first. */
export function weeklyTotals(days: InsightsDay[]): { weekStart: string; values: number[]; total: number }[] {
  const out: { weekStart: string; values: number[]; total: number }[] = []
  for (let i = 0; i < days.length; i += 7) {
    const wk = days.slice(i, i + 7)
    const values = wk[0].values.map((_, k) => wk.reduce((s, d) => s + (d.values[k] ?? 0), 0))
    out.push({ weekStart: wk[0].date, values, total: values.reduce((s, v) => s + v, 0) })
  }
  return out
}

/** Average daily total per weekday (0 = Mon), over elapsed days only so the empty future doesn't drag it down. */
export function weekdayAverages(days: InsightsDay[], today: string): { day: number; avg: number }[] {
  return Array.from({ length: 7 }, (_, day) => {
    const past = days.filter((d, i) => i % 7 === day && d.date <= today)
    return { day, avg: past.length ? Math.round((past.reduce((s, d) => s + dayTotal(d), 0) / past.length) * 100) / 100 : 0 }
  })
}

const csvCell = (v: string | number) => {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
export const csvRow = (cells: (string | number)[]) => cells.map(csvCell).join(',')

/** date, one column per series (plus total when stacked) and the top breakdown as `Name:n|Name:n` when present. */
export function insightsToCsv(s: Pick<InsightsSeries, 'series' | 'days'>): string {
  const stacked = s.series.length > 1
  const top = s.days.some(d => d.top?.length)
  const rows = [csvRow(['date', ...s.series.map(x => x.key), ...(stacked ? ['total'] : []), ...(top ? ['top'] : [])])]
  for (const d of s.days) {
    rows.push(csvRow([d.date, ...s.series.map((_, i) => d.values[i] ?? 0), ...(stacked ? [dayTotal(d)] : []), ...(top ? [(d.top ?? []).map(t => `${t.name}:${t.count}`).join('|')] : [])]))
  }
  return rows.join('\n')
}
