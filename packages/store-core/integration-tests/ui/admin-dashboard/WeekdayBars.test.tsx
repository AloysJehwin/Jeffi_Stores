import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WeekdayBars } from '@/components/admin/dashboard/WeekdayBars'
import { mockReducedMotion } from './fixtures'

const days = ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09', '2026-01-10', '2026-01-11'].map((date, i) => ({ date, placed: [3, 9, 6, 0, 4, 2, 1][i] }))

describe('WeekdayBars', () => {
  beforeEach(() => mockReducedMotion(true))

  it('renders a bar per day with its count and highlights today', () => {
    const { container } = render(<WeekdayBars days={days} avg={4.25} today="2026-01-06" />)
    expect(container.querySelectorAll('[data-bar]')).toHaveLength(7)
    expect(container.querySelectorAll('[data-bar="today"]')).toHaveLength(1)
    expect(screen.getByRole('img', { name: /Tue, 6 Jan: 9 placed \(today\)/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Mon, 5 Jan: 3 placed$/ })).toBeInTheDocument()
    for (const d of ['Mon', 'Tue', 'Sun']) expect(screen.getByText(d)).toBeInTheDocument()
  })

  it('draws the dashed average line with its label', () => {
    const { container } = render(<WeekdayBars days={days} avg={4.25} />)
    expect(container.querySelector('[data-avg-line]')).toBeInTheDocument()
    expect(screen.getByText('Avg 4.3')).toBeInTheDocument()
  })

  it('shows an empty state and no average line when nothing was placed', () => {
    const { container } = render(<WeekdayBars days={days.map(d => ({ ...d, placed: 0 }))} avg={0} />)
    expect(screen.getByText('No orders placed this week yet.')).toBeInTheDocument()
    expect(container.querySelector('[data-avg-line]')).not.toBeInTheDocument()
  })

  it('channel chips call back with the chosen channel', () => {
    const onChannelChange = vi.fn()
    render(
      <WeekdayBars
        days={days}
        avg={4}
        channels={[
          { value: 'all', label: 'All' },
          { value: 'cod', label: 'COD' },
        ]}
        channel="all"
        onChannelChange={onChannelChange}
      />
    )
    expect(screen.getByRole('radio', { name: 'All' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('radio', { name: 'COD' }))
    expect(onChannelChange).toHaveBeenCalledWith('cod')
  })

  it('omits the chips without a handler', () => {
    render(<WeekdayBars days={days} avg={4} channels={[{ value: 'all', label: 'All' }]} />)
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
  })
})
