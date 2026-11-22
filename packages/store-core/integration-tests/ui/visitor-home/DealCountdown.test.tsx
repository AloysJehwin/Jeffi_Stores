import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import DealCountdown from '@/components/visitor/home/DealCountdown'

// DealCountdown: a 'use client' timer. It starts null (SSR/first paint parity) and fills in on mount.
// We drive wall-clock with fake timers so the remaining split is deterministic.

afterEach(() => {
  vi.useRealTimers()
})

describe('DealCountdown (render + ticking)', () => {
  it('renders nothing until mounted and renders nothing for a past deadline', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const { container } = render(<DealCountdown endsAt="2025-12-31T00:00:00Z" />)
    act(() => {
      vi.advanceTimersByTime(0)
    })
    expect(container.firstChild).toBeNull()
  })

  it('shows days/hours/min/sec for a future deadline', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    // 2d 03h 04m 05s ahead.
    render(<DealCountdown endsAt="2026-01-03T03:04:05Z" />)
    act(() => {
      vi.advanceTimersByTime(0)
    })
    expect(screen.getByRole('timer', { name: 'Offer ends in' })).toBeInTheDocument()
    expect(screen.getByText('Days')).toBeInTheDocument()
    expect(screen.getByText('02')).toBeInTheDocument() // days, zero-padded
    expect(screen.getByText('03')).toBeInTheDocument() // hours
    expect(screen.getByText('04')).toBeInTheDocument() // minutes
    expect(screen.getByText('05')).toBeInTheDocument() // seconds
  })

  it('omits the Days block when under 24h remain', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    render(<DealCountdown endsAt="2026-01-01T05:00:00Z" />)
    act(() => {
      vi.advanceTimersByTime(0)
    })
    expect(screen.queryByText('Days')).toBeNull()
    expect(screen.getByText('Hrs')).toBeInTheDocument()
  })
})
