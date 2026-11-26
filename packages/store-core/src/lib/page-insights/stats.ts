import type { InsightsSeries } from '@/lib/insights/series'
import type { InsightsStat } from '@/components/admin/insights'
import { fmtLong, nf } from '@/components/admin/dashboard/viz'

export interface SeriesSum {
  key: string
  label: string
  total: number
}

/** The period sum of each series. */
export function seriesSums(s: Pick<InsightsSeries, 'series' | 'days'>): SeriesSum[] {
  return s.series.map((x, i) => ({ key: x.key, label: x.label, total: Math.round(s.days.reduce((n, d) => n + (d.values[i] ?? 0), 0) * 100) / 100 }))
}

/** `part` as a percentage of `whole`, one decimal; null when there is no whole. */
export function percentOf(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null
}

export interface PageStatsOpts {
  /** A rate stat: series index `of` as a share of series index `over`, e.g. conversions over sends. */
  rate?: { label: string; of: number; over: number }
}

/** The stat strip for a page's series: each series' period sum (two with a rate, else up to three), an optional rate and the busiest day. */
export function pageStats(s: InsightsSeries, opts: PageStatsOpts = {}): InsightsStat[] {
  const sums = seriesSums(s)
  const out: InsightsStat[] = sums.slice(0, opts.rate ? 2 : 3).map((x, i) => ({ label: x.label, value: nf(x.total), sub: `${s.weeks} weeks`, accent: i === 0 }))
  if (opts.rate) {
    const p = percentOf(sums[opts.rate.of]?.total ?? 0, sums[opts.rate.over]?.total ?? 0)
    out.push({ label: opts.rate.label, value: p == null ? '–' : `${p}%`, sub: `${sums[opts.rate.of]?.label ?? ''} of ${sums[opts.rate.over]?.label ?? ''}`.toLowerCase() })
  }
  const b = s.totals.busiestDay
  out.push({ label: 'Busiest day', value: b ? nf(b.count) : '–', sub: b ? fmtLong(b.date) : undefined })
  return out
}

export interface PartStatsOpts {
  totalLabel: string
  /** Index of the series whose share of the total is the rate. */
  partIndex: number
  partLabel: string
  rateLabel: string
}

/** The stat strip when the series stack to one total (sends, messages) and one part of it matters (conversions, failures). */
export function partStats(s: InsightsSeries, o: PartStatsOpts): InsightsStat[] {
  const sums = seriesSums(s)
  const total = sums.reduce((n, x) => n + x.total, 0)
  const part = sums[o.partIndex]?.total ?? 0
  const rate = percentOf(part, total)
  const b = s.totals.busiestDay
  return [
    { label: o.totalLabel, value: nf(total), sub: `${s.weeks} weeks`, accent: true },
    { label: o.partLabel, value: nf(part), sub: `${s.weeks} weeks` },
    { label: o.rateLabel, value: rate == null ? '–' : `${rate}%`, sub: `of ${o.totalLabel.toLowerCase()}` },
    { label: 'Busiest day', value: b ? nf(b.count) : '–', sub: b ? fmtLong(b.date) : undefined },
  ]
}
