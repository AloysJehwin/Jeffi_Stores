import { describe, it, expect } from 'vitest'
import { mondayGrid, summarize, type InsightsSeries } from '@/lib/insights/series'
import { mergeInsightsSeries } from '@/lib/page-insights/merge'
import { pageStats, partStats, percentOf, seriesSums } from '@/lib/page-insights/stats'

const today = '2026-11-26'
const grid = mondayGrid(today, 2)
function make(defs: [string, string][], at: Record<number, number[]>): InsightsSeries {
  const days = grid.dates.map((date, i) => ({ date, values: at[i] ?? defs.map(() => 0) }))
  return { weeks: 2, filter: null, from: grid.from, to: grid.to, today, series: defs.map(([key, label]) => ({ key, label })), days, totals: summarize(days, today) }
}

describe('mergeInsightsSeries', () => {
  it('concatenates series and per-day values and recomputes the totals', () => {
    const a = make([['a', 'A']], { 9: [4] })
    const b = make([['b', 'B']], { 9: [1], 10: [2] })
    const m = mergeInsightsSeries([a, b])
    expect(m.series.map(s => s.key)).toEqual(['a', 'b'])
    expect(m.days[9].values).toEqual([4, 1])
    expect(m.days[10].values).toEqual([0, 2])
    expect(m.totals.total).toBe(7)
    expect(m.totals.busiestDay).toEqual({ date: grid.dates[9], count: 5 })
  })
})

describe('page stats', () => {
  const s = make(
    [['x', 'Sends'], ['y', 'Converted']],
    { 3: [8, 2], 4: [2, 0] }
  )

  it('sums each series and rounds the share of a whole', () => {
    expect(seriesSums(s).map(x => x.total)).toEqual([10, 2])
    expect(percentOf(1, 3)).toBe(33.3)
    expect(percentOf(1, 0)).toBeNull()
  })

  it('pageStats lists series sums, an optional rate and the busiest day', () => {
    const stats = pageStats(s, { rate: { label: 'Rate', of: 1, over: 0 } })
    expect(stats.map(x => x.label)).toEqual(['Sends', 'Converted', 'Rate', 'Busiest day'])
    expect(stats[2].value).toBe('20%')
    expect(stats[0].accent).toBe(true)
    expect(pageStats(s).map(x => x.label)).toEqual(['Sends', 'Converted', 'Busiest day'])
  })

  it('partStats totals every series and shows one part and its rate', () => {
    const stats = partStats(s, { totalLabel: 'Sends', partIndex: 1, partLabel: 'Conversions', rateLabel: 'Conversion rate' })
    expect(stats.map(x => [x.label, x.value])).toEqual([['Sends', '12'], ['Conversions', '2'], ['Conversion rate', '16.7%'], ['Busiest day', '10']])
    expect(partStats(make([['x', 'X'], ['y', 'Y']], {}), { totalLabel: 'T', partIndex: 1, partLabel: 'P', rateLabel: 'R' })[2].value).toBe('–')
  })
})
