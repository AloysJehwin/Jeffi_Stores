// Pure helpers for the inventory overview endpoint.

const DAY = 86_400_000
const ISO = /^\d{4}-\d{2}-\d{2}$/
export const MAX_RANGE_DAYS = 400
export const MIN_COVER_DAYS = 14
export const DEFAULT_LEAD_DAYS = 7
export const SAFETY_DAYS = 30

const toTime = (d: string) => Date.parse(`${d}T00:00:00Z`)
const toDay = (t: number) => new Date(t).toISOString().slice(0, 10)
export const addDays = (d: string, n: number) => toDay(toTime(d) + n * DAY)

function valid(d: string | null | undefined): d is string {
  return !!d && ISO.test(d) && !Number.isNaN(toTime(d))
}

export interface Period {
  from: string
  to: string
  prevFrom: string
  prevTo: string
  days: number
}

// Inclusive IST business days; previous period is the equal-length window just before.
export function resolvePeriod(from: string | null, to: string | null, today: string): Period {
  let f = valid(from) ? from : null
  let t = valid(to) ? to : null
  if (!f || !t) {
    t = today
    f = addDays(today, -29)
  }
  if (f > t) [f, t] = [t, f]
  let days = Math.round((toTime(t) - toTime(f)) / DAY) + 1
  if (days > MAX_RANGE_DAYS) {
    f = addDays(t, -(MAX_RANGE_DAYS - 1))
    days = MAX_RANGE_DAYS
  }
  const prevTo = addDays(f, -1)
  return { from: f, to: t, prevFrom: addDays(prevTo, -(days - 1)), prevTo, days }
}

export const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}

export interface ReorderInput {
  qty: unknown
  sold: unknown
  lead_time_days?: unknown
  moq?: unknown
  purchase_unit_factor?: unknown
}

export interface ReorderAdvice {
  avgDaily: number
  daysOfCover: number
  thresholdDays: number
  leadTimeDays: number | null
  suggestedQty: number
}

// Days of cover = on hand / average daily net sales. Flag when it is below max(lead time, 14 days);
// suggest enough to cover the threshold plus a 30-day buffer, rounded up to the supplier MOQ.
export function reorderAdvice(row: ReorderInput, days: number): ReorderAdvice | null {
  const sold = num(row.sold)
  if (sold <= 0 || days <= 0) return null
  const onHand = Math.max(0, num(row.qty))
  const avgDaily = sold / days
  const daysOfCover = onHand / avgDaily
  const lead = row.lead_time_days == null || row.lead_time_days === '' ? null : num(row.lead_time_days)
  const thresholdDays = Math.max(lead ?? 0, MIN_COVER_DAYS)
  if (daysOfCover >= thresholdDays) return null
  const target = Math.max(lead ?? DEFAULT_LEAD_DAYS, MIN_COVER_DAYS) + SAFETY_DAYS
  let suggestedQty = Math.max(1, Math.ceil(avgDaily * target - onHand))
  const moqBase = num(row.moq) * (num(row.purchase_unit_factor) || 1)
  if (moqBase > 0 && suggestedQty < moqBase) suggestedQty = Math.ceil(moqBase)
  return { avgDaily, daysOfCover, thresholdDays, leadTimeDays: lead, suggestedQty }
}

export function buildReorder<T extends ReorderInput>(rows: T[], days: number, limit = 25): (T & ReorderAdvice)[] {
  const out: (T & ReorderAdvice)[] = []
  for (const r of rows) {
    const a = reorderAdvice(r, days)
    if (a) out.push({ ...r, ...a })
  }
  return out.sort((a, b) => a.daysOfCover - b.daysOfCover || b.avgDaily - a.avgDaily).slice(0, limit)
}

// Period turnover = cost of goods sold / stock value at cost (current stock stands in for the
// period average: there is no stock snapshot history). Days of cover = stock value / daily COGS.
export function turnoverStats(cogs: number, stockValue: number, days: number) {
  const turnover = stockValue > 0 ? cogs / stockValue : null
  const daily = days > 0 ? cogs / days : 0
  return {
    turnover,
    annualTurnover: turnover == null || days <= 0 ? null : (turnover * 365) / days,
    daysOfCover: daily > 0 ? stockValue / daily : null,
  }
}
