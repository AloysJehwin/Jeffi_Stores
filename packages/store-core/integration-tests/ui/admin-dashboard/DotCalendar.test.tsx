import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { DotCalendar } from '@/components/admin/dashboard/DotCalendar'
import { makeDays } from './fixtures'

describe('DotCalendar', () => {
  it('renders one dot per day, shading by count and leaving zero days neutral', () => {
    const days = makeDays(6)
    const { container } = render(<DotCalendar days={days} />)
    expect(container.querySelectorAll('[data-dot]')).toHaveLength(42)
    const zero = container.querySelector(`[data-dot="0"]`)!
    const peak = container.querySelector(`[data-dot="10"]`)!
    expect(zero.getAttribute('fill')).toContain('surface-secondary')
    expect(peak.getAttribute('fill')).toContain('--c-accent-800')
    const low = container.querySelector(`[data-dot="1"]`)!
    expect(low.getAttribute('fill')).toContain('--c-accent-200')
  })

  it('shows the day and count on hover and hides it on leave', () => {
    const days = makeDays(6)
    const { container } = render(<DotCalendar days={days} />)
    fireEvent.pointerEnter(container.querySelector('[data-dot="10"]')!)
    const tip = screen.getByRole('tooltip')
    expect(within(tip).getByText('30 shipped')).toBeInTheDocument()
    expect(within(tip).getByText('Thu, 15 Jan')).toBeInTheDocument()
    fireEvent.pointerLeave(container.querySelector('[data-dot="10"]')!.closest('div')!)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('labels the months and carries the Less/More legend', () => {
    render(<DotCalendar days={makeDays(8)} />)
    expect(screen.getByText('Jan')).toBeInTheDocument()
    expect(screen.getByText('Feb')).toBeInTheDocument()
    expect(screen.getByText(/Less/)).toBeInTheDocument()
    expect(screen.getByText(/More/)).toBeInTheDocument()
  })

  it('renders an empty state without days', () => {
    render(<DotCalendar days={[]} />)
    expect(screen.getByText('No shipments yet.')).toBeInTheDocument()
  })
})
