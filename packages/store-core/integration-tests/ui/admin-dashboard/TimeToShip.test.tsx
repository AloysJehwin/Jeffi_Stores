import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TimeToShip } from '@/components/admin/dashboard/TimeToShip'
import { makeActivity, mockReducedMotion } from './fixtures'

describe('TimeToShip', () => {
  beforeEach(() => mockReducedMotion(true))
  const a = makeActivity()

  it('shows every bucket, flags the tallest, the median badge and the caption', () => {
    const { container } = render(<TimeToShip buckets={a.timeToShip} medianDays={1.8} within2dPct={66.4} />)
    for (const b of ['<1d', '1-2d', '2-4d', '4-7d', '7d+']) expect(screen.getByText(b)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '1-2d: 40 orders' })).toBeInTheDocument()
    expect(container.querySelector('[data-bar="peak"]')).toBeInTheDocument()
    expect(screen.getByText('Median 1.8d')).toBeInTheDocument()
    expect(screen.getByText('66% ship within 2 days')).toBeInTheDocument()
  })

  it('omits the badge and caption when unknown', () => {
    render(<TimeToShip buckets={a.timeToShip} medianDays={null} within2dPct={null} />)
    expect(screen.queryByText(/Median/)).not.toBeInTheDocument()
    expect(screen.queryByText(/within 2 days/)).not.toBeInTheDocument()
  })

  it('renders an empty state with no shipped orders', () => {
    render(<TimeToShip buckets={a.timeToShip.map(b => ({ ...b, count: 0 }))} medianDays={null} within2dPct={null} />)
    expect(screen.getByText('No shipped orders yet.')).toBeInTheDocument()
  })
})
