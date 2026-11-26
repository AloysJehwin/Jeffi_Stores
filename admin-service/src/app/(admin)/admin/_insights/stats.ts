import type { InsightsCopy, InsightsSeries, InsightsStat } from '@/components/admin/insights'

const nf = (n: number) => n.toLocaleString('en-IN')

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
