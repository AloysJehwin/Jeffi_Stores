import { summarize, type InsightsSeries } from '@/lib/insights/series'

/**
 * One series from several single-table ones over the same weeks: series and per-day values are concatenated in order
 * and totals recomputed. The first part's filter, `top` and `note` lead; later parts only add their series.
 */
export function mergeInsightsSeries(parts: [InsightsSeries, ...InsightsSeries[]]): InsightsSeries {
  const first = parts[0]
  const days = first.days.map((d, i) => ({ ...d, values: parts.flatMap(p => p.days[i]?.values ?? p.series.map(() => 0)) }))
  return { ...first, series: parts.flatMap(p => p.series), days, totals: summarize(days, first.today) }
}
