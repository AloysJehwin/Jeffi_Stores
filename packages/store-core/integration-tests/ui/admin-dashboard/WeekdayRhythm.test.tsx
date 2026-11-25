import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WeekdayRhythm } from '@/components/admin/dashboard/WeekdayRhythm'
import { mockReducedMotion } from './fixtures'

describe('WeekdayRhythm', () => {
  beforeEach(() => mockReducedMotion(true))

  it('renders seven bars with the peak flagged and the caption', () => {
    const weekday = [4, 12, 8, 6, 5, 1, 0.5].map((avg, day) => ({ day, avg }))
    const { container } = render(<WeekdayRhythm weekday={weekday} />)
    expect(container.querySelectorAll('[data-bar]')).toHaveLength(7)
    expect(container.querySelectorAll('[data-bar="peak"]')).toHaveLength(1)
    expect(screen.getByRole('img', { name: 'Tuesday: 12 shipped per day on average' })).toBeInTheDocument()
    expect(screen.getByText('Tue peak · weekends 0.8')).toBeInTheDocument()
  })

  it('treats missing weekdays as zero', () => {
    render(<WeekdayRhythm weekday={[{ day: 2, avg: 3 }]} />)
    expect(screen.getByRole('img', { name: 'Monday: 0 shipped per day on average' })).toBeInTheDocument()
    expect(screen.getByText(/Wed peak/)).toBeInTheDocument()
  })

  it('renders an empty state when nothing shipped', () => {
    render(<WeekdayRhythm weekday={[]} />)
    expect(screen.getByText('No shipments yet.')).toBeInTheDocument()
  })
})
