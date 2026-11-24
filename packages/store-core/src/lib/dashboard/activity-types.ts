export type ActivityChannel = 'all' | 'online' | 'cod' | 'business'

export interface ActivityDay {
  date: string // YYYY-MM-DD, local store day
  shipped: number
  placed: number
  customers: number // distinct customers among that day's shipped orders
  top: { name: string; count: number }[] // top categories by shipped units that day, at most 3
}

export interface DashboardActivity {
  weeks: number
  channel: ActivityChannel
  from: string // Monday of the first week
  to: string // Sunday of the last week (may be in the future; future days have zeros)
  days: ActivityDay[] // weeks * 7 entries, oldest first, Monday-aligned
  totals: {
    shipped: number
    busiestDay: { date: string; count: number } | null
    longestStreak: number // consecutive days with shipped > 0
    currentStreak: number // ending today (or yesterday if nothing shipped yet today)
  }
  weekday: { day: number; avg: number }[] // 0 = Mon … 6 = Sun, average shipped per day
  thisWeek: { date: string; placed: number }[] // Mon..Sun of the current week
  placedAvg8w: number // average placed orders per day over the last 8 full weeks
  timeToShip: { bucket: '<1d' | '1-2d' | '2-4d' | '4-7d' | '7d+'; count: number }[]
  medianDaysToShip: number | null
  shippedWithin2dPct: number | null
  throughput: { weekStart: string; placed: number; shipped: number }[] // one per week, oldest first
  backlog: number // placed but not yet shipped (and not cancelled), right now
  topProducts: { id: string; name: string; shipped: number; onTimePct: number | null; avgDays: number | null; weekly: number[] }[] // up to 8 products; weekly = the last 8 weeks, oldest first
}

export interface DashboardSeries {
  trendPrev: { label: string; revenue: number; orders: number }[] // same buckets as `trend`, for the previous period
  spark: { orders: number[]; aov: number[]; customers: number[]; conversion: number[] } // one value per trend bucket
  flow: { placed: number; paid: number; shipped: number; delivered: number; cancelled: number; returned: number } // counts, for orders placed in the range
}
