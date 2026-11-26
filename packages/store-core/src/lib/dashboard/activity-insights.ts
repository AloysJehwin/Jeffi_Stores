import type { DashboardActivity } from './activity-types'
import type { InsightsSeries } from '@/lib/insights/series'

/** The dashboard's shipped-orders activity as an insights series; the full activity rides along as `extra`. */
export function activityToInsights(a: DashboardActivity, today?: string): InsightsSeries<DashboardActivity> {
  return {
    weeks: a.weeks,
    filter: a.channel,
    from: a.from,
    to: a.to,
    today: today ?? a.to,
    series: [{ key: 'shipped', label: 'Shipped' }],
    days: a.days.map(d => ({ date: d.date, values: [d.shipped], top: d.top, note: `${d.customers} ${d.customers === 1 ? 'customer' : 'customers'}` })),
    totals: { total: a.totals.shipped, busiestDay: a.totals.busiestDay, longestStreak: a.totals.longestStreak, currentStreak: a.totals.currentStreak },
    extra: a,
  }
}
