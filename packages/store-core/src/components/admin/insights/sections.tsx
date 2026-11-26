'use client'

import { WeekdayRhythm } from '../dashboard/WeekdayRhythm'
import { ThroughputLines } from '../dashboard/ThroughputLines'
import { weekdayAverages, weeklyTotals } from '@/lib/insights/series'
import type { InsightsSection } from './InsightsDrawer'

interface SectionOpts {
  title?: string
  half?: boolean
  empty?: string
}

/** Average daily total per weekday (elapsed days only), peak day in accent. Half width by default. */
export function weekdaySection({ title = 'Weekday rhythm', half = true, empty }: SectionOpts = {}): InsightsSection {
  return {
    title,
    half,
    render: (s, copy) => <WeekdayRhythm weekday={weekdayAverages(s.days, s.today)} unit={copy.unit} emptyText={empty ?? copy.empty ?? 'Nothing in this range.'} />,
  }
}

/**
 * Weekly totals as lines: one series draws one line, two draw the first solid and the second dashed, more than two
 * draw their stacked total. Full width by default.
 */
export function weeklySection({ title = 'Weekly', half = false, empty }: SectionOpts = {}): InsightsSection {
  return {
    title,
    half,
    render: (s, copy) => {
      const two = s.series.length === 2
      const first = s.series.length === 1 || two ? s.series[0].label : 'Total'
      const weeks = weeklyTotals(s.days).map(w => ({ weekStart: w.weekStart, shipped: s.series.length > 2 ? w.total : w.values[0] ?? 0, placed: two ? w.values[1] ?? 0 : 0 }))
      return (
        <ThroughputLines
          throughput={weeks}
          labels={{ shipped: first, placed: two ? s.series[1].label : null }}
          ariaLabel={`Weekly ${copy.subject.toLowerCase()}`}
          emptyText={empty ?? copy.empty ?? 'Nothing in this range.'}
        />
      )
    },
  }
}
