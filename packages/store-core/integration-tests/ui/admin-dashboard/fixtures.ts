import type { ActivityDay, DashboardActivity } from '@/lib/dashboard/activity-types'

/** Stubs window.matchMedia for the reduced-motion preference. */
export function mockReducedMotion(reduce: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

/** Monday-aligned days starting 2026-01-05; shipped = (i % 5) * 2 except one clear peak. */
export function makeDays(weeks: number): ActivityDay[] {
  const start = new Date(2026, 0, 5)
  return Array.from({ length: weeks * 7 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const shipped = i === 10 ? 30 : (i % 5) * 2
    return {
      date: iso,
      shipped,
      placed: shipped + 1,
      customers: Math.max(0, shipped - 1),
      top: shipped >= 4 ? [{ name: 'Shirts', count: Math.floor(shipped / 2) }, { name: 'Shoes', count: Math.floor(shipped / 4) }] : [],
    }
  })
}

export function makeActivity(weeks = 4): DashboardActivity {
  const days = makeDays(weeks)
  return {
    weeks,
    channel: 'all',
    from: days[0].date,
    to: days[days.length - 1].date,
    days,
    totals: { shipped: days.reduce((s, d) => s + d.shipped, 0), busiestDay: { date: days[10].date, count: 30 }, longestStreak: 6, currentStreak: 2 },
    weekday: [4, 12, 8, 6, 5, 1, 0.5].map((avg, day) => ({ day, avg })),
    thisWeek: days.slice(0, 7).map(d => ({ date: d.date, placed: d.placed })),
    placedAvg8w: 5,
    timeToShip: [
      { bucket: '<1d', count: 10 },
      { bucket: '1-2d', count: 40 },
      { bucket: '2-4d', count: 20 },
      { bucket: '4-7d', count: 5 },
      { bucket: '7d+', count: 1 },
    ],
    medianDaysToShip: 1.8,
    shippedWithin2dPct: 66,
    throughput: Array.from({ length: weeks }, (_, w) => ({ weekStart: days[w * 7].date, placed: 20 + w, shipped: 18 + w * 2 })),
    backlog: 7,
    topProducts: [
      { id: 'p1', name: 'Linen shirt', shipped: 41, onTimePct: 96, avgDays: 1.4, weekly: [1, 2, 3, 4, 5, 6, 7, 8] },
      { id: 'p2', name: 'Canvas shoe', shipped: 12, onTimePct: null, avgDays: null, weekly: [0, 0, 1, 0, 2, 0, 1, 0] },
    ],
  }
}
