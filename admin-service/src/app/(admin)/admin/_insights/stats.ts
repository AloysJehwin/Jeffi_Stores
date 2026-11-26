import { defaultInsightsStats, type InsightsCopy, type InsightsSeries, type InsightsStat } from '@/components/admin/insights'
import { nf } from '@/components/admin/dashboard/viz'

/** Stat strip: the period total, then each picked series with its share of it, topped up with the default busiest day and streaks. Four tiles. */
export function shareStats(s: InsightsSeries<unknown>, copy: InsightsCopy, picks: { key: string; label?: string }[]): InsightsStat[] {
  const [total, ...rest] = defaultInsightsStats(s, copy)
  const sums = s.series.map((_, i) => s.days.reduce((n, d) => n + (d.values[i] ?? 0), 0))
  const shares = picks.flatMap(p => {
    const i = s.series.findIndex(x => x.key === p.key)
    if (i < 0) return []
    return [{ label: p.label ?? s.series[i].label, value: nf(sums[i]), sub: s.totals.total ? `${Math.round((sums[i] / s.totals.total) * 100)}% of total` : undefined }]
  })
  return [total, ...shares, ...rest].slice(0, 4)
}
