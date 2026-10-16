// Pure helpers for the inventory overview endpoint.
import { num } from '@/lib/purchasing/reorder'

const DAY = 86_400_000
const ISO = /^\d{4}-\d{2}-\d{2}$/
export const MAX_RANGE_DAYS = 400

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

export { num, reorderAdvice, buildReorder, MIN_COVER_DAYS, DEFAULT_LEAD_DAYS, SAFETY_DAYS } from '@/lib/purchasing/reorder'
export type { ReorderInput, ReorderAdvice } from '@/lib/purchasing/reorder'
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
