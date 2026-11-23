import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import ComposedCountdown from '@/components/visitor/site/ComposedCountdown'

// A ticking countdown to `endsAt`. First paint shows the server state (dashes, `now === null`);
// after the mount effect runs it ticks every second, and it unmounts itself once the deadline passes.

describe('ComposedCountdown (render + ticking)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // A fixed "now" so remaining time is deterministic.
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the four unit labels', () => {
    const endsAt = new Date('2026-01-02T00:00:00Z').toISOString()
    render(<ComposedCountdown endsAt={endsAt} label="" />)
    expect(screen.getByText('Days')).toBeInTheDocument()
    expect(screen.getByText('Hours')).toBeInTheDocument()
    expect(screen.getByText('Mins')).toBeInTheDocument()
    expect(screen.getByText('Secs')).toBeInTheDocument()
    // RTL flushes the mount effect synchronously, so values are already padded numbers (not the "--" SSR placeholder).
    expect(screen.queryByText('--')).toBeNull()
  })

  it('renders the label when provided', () => {
    const endsAt = new Date('2026-01-02T00:00:00Z').toISOString()
    render(<ComposedCountdown endsAt={endsAt} label="Sale ends in" />)
    expect(screen.getByText('Sale ends in')).toBeInTheDocument()
  })

  it('has a timer role for assistive tech', () => {
    const endsAt = new Date('2026-01-02T00:00:00Z').toISOString()
    render(<ComposedCountdown endsAt={endsAt} label="" />)
    expect(screen.getByRole('timer')).toBeInTheDocument()
  })

  it('ticks to the real remaining time once the mount effect runs (1 day left)', () => {
    const endsAt = new Date('2026-01-02T00:00:00Z').toISOString()
    render(<ComposedCountdown endsAt={endsAt} label="" />)
    // Flush the mount effect + its first setNow.
    act(() => {
      vi.advanceTimersByTime(0)
    })
    // 24h left -> Days cell "01", padded.
    expect(screen.getByText('01')).toBeInTheDocument()
    // Hours/Mins/Secs all zero -> three "00" cells.
    expect(screen.getAllByText('00').length).toBe(3)
  })

  it('unmounts itself (renders nothing) once the deadline has passed', () => {
    const endsAt = new Date('2026-01-01T00:00:05Z').toISOString() // 5s ahead
    const { container } = render(<ComposedCountdown endsAt={endsAt} label="" />)
    act(() => {
      vi.advanceTimersByTime(6000) // past the deadline
    })
    expect(container.firstChild).toBeNull()
  })
})
