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

/**
 * Stat strip for a page's insights: the period total, then each series' total with its share, and the busiest
 * day when there is room. `money` shows rupee amounts.
 */
export function seriesStats({ money = false }: { money?: boolean } = {}) {
  const fmt = (n: number) => (money ? `₹${nf(Math.round(n))}` : nf(n))
  return (s: InsightsSeries, copy: InsightsCopy): InsightsStat[] => {
    const per = s.series.map((_, i) => s.days.reduce((sum, d) => sum + (d.values[i] ?? 0), 0))
    const sum = per.reduce((a, b) => a + b, 0)
    const stats: InsightsStat[] = [{ label: `${s.weeks}-week total`, value: fmt(s.totals.total), sub: copy.noun, accent: true }]
    s.series.slice(0, 3).forEach((def, i) => {
      stats.push({ label: def.label, value: fmt(per[i]), sub: sum > 0 ? `${Math.round((per[i] / sum) * 100)}% of total` : undefined })
    })
    const busiest = s.totals.busiestDay
    if (stats.length < 4) stats.push({ label: 'Busiest day', value: busiest ? fmt(busiest.count) : '–', sub: busiest?.date })
    return stats
  }
}
