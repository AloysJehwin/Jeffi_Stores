import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { totalVsPartSection } from '@/components/admin/insights-pages/sections'
import { mondayGrid, summarize, type InsightsSeries } from '@/lib/insights/series'

const grid = mondayGrid('2026-01-14', 2)
const days = grid.dates.map((date, i) => ({ date, values: [i, i % 2] }))
const series: InsightsSeries = { weeks: 2, filter: null, from: grid.from, to: grid.to, today: '2026-01-14', series: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], days, totals: summarize(days, '2026-01-14') }
const copy = { subject: 'Things', unit: 'things', noun: 'things' }

describe('totalVsPartSection', () => {
  it('draws the weekly total against one part, counting a negative index from the end', () => {
    const section = totalVsPartSection({ title: 'Total vs B', totalLabel: 'All', partLabel: 'B', partIndex: -1, half: true })
    expect(section.title).toBe('Total vs B')
    expect(section.half).toBe(true)
    const { container, getByText } = render(<>{section.render(series, copy)}</>)
    expect(container.querySelector('svg')).not.toBeNull()
    expect(getByText('All')).toBeInTheDocument()
    expect(getByText('B')).toBeInTheDocument()
  })
})
