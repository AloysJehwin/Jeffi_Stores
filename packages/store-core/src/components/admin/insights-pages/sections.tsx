'use client'

import { ThroughputLines } from '../dashboard/ThroughputLines'
import { weeklyTotals } from '@/lib/insights/series'
import type { InsightsSection } from '../insights'

/**
 * Weekly lines for series that stack to one total: the full total solid and one part of it (conversions, failures)
 * dashed. `partIndex` counts from the end when negative. Full width by default.
 */
export function totalVsPartSection({ title, totalLabel, partLabel, partIndex, half = false }: { title: string; totalLabel: string; partLabel: string; partIndex: number; half?: boolean }): InsightsSection {
  return {
    title,
    half,
    render: (s, copy) => {
      const i = partIndex < 0 ? s.series.length + partIndex : partIndex
      return (
        <ThroughputLines
          throughput={weeklyTotals(s.days).map(w => ({ weekStart: w.weekStart, shipped: w.total, placed: w.values[i] ?? 0 }))}
          labels={{ shipped: totalLabel, placed: partLabel }}
          ariaLabel={`Weekly ${copy.subject.toLowerCase()}`}
          emptyText={copy.empty ?? 'Nothing in this range.'}
        />
      )
    },
  }
}
