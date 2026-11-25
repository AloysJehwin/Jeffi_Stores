import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import Countdown from '@/components/visitor/site/code/islands/Countdown'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('site Countdown island', () => {
  it('shows days, hours, mins and secs as boxes, with the label, and ticks each second', () => {
    render(<Countdown endsAt="2026-01-02T03:04:05Z" label="Sale ends" />)
    expect(screen.getByRole('timer')).toBeInTheDocument()
    expect(screen.getByText('Sale ends')).toBeInTheDocument()
    for (const unit of ['Days', 'Hours', 'Mins', 'Secs']) expect(screen.getByText(unit)).toBeInTheDocument()
    expect(screen.getByText('01')).toBeInTheDocument()
    expect(screen.getByText('03')).toBeInTheDocument()
    expect(screen.getByText('04')).toBeInTheDocument()
    expect(screen.getByText('05')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.queryByText('05')).toBeNull() // secs 05 -> 04
    expect(screen.getAllByText('04')).toHaveLength(2) // mins and secs
  })

  it('renders the compact inline variant, dropping the days when under a day', () => {
    const { rerender } = render(<Countdown endsAt="2026-01-02T03:04:05Z" variant="inline" label="Ends" />)
    expect(screen.getByRole('timer')).toHaveTextContent('Ends1d 03:04:05')
    rerender(<Countdown endsAt="2026-01-01T01:02:03Z" variant="inline" />)
    expect(screen.getByRole('timer')).toHaveTextContent('01:02:03')
    expect(screen.getByRole('timer')).not.toHaveTextContent('d ')
  })

  it('disappears once the deadline passes', () => {
    const { container } = render(<Countdown endsAt="2026-01-01T00:00:03Z" />)
    expect(screen.getByRole('timer')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(4000)
    })
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for an invalid date', () => {
    const { container } = render(<Countdown endsAt="not-a-date" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('stops its interval on unmount', () => {
    const { unmount } = render(<Countdown endsAt="2026-01-02T00:00:00Z" />)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
