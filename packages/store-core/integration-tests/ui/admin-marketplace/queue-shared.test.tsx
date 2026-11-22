import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusPill, Countdown, CHANNEL_NAME, MARKET_STATUS, RETURN_STATUS } from '@/components/admin/marketplace/queue-shared'

// Shared, server-free bits of the marketplace tabs: the channel-name map, the status->label/tone
// maps, the StatusPill (looks a status up in a map, falls back to a de-underscored label) and the
// Countdown (time left / overdue against a deadline).

describe('channel + status maps', () => {
  it('names each channel', () => {
    expect(CHANNEL_NAME.myntra).toBe('Myntra')
    expect(CHANNEL_NAME.ajio).toBe('AJIO')
    expect(CHANNEL_NAME.flipkart).toBe('Flipkart')
  })

  it('maps order and return statuses to labels', () => {
    expect(MARKET_STATUS.created.label).toBe('New')
    expect(MARKET_STATUS.shipped.tone).toBe('green')
    expect(RETURN_STATUS.qc_failed.label).toBe('QC failed')
    expect(RETURN_STATUS.qc_failed.tone).toBe('red')
  })
})

describe('StatusPill (render)', () => {
  it('renders the mapped label for a known status', () => {
    render(<StatusPill status="ready_to_dispatch" />)
    expect(screen.getByText('Ready to dispatch')).toBeInTheDocument()
  })

  it('falls back to a de-underscored status when unmapped', () => {
    render(<StatusPill status="some_weird_state" />)
    expect(screen.getByText('some weird state')).toBeInTheDocument()
  })

  it('uses a supplied map (returns) over the default', () => {
    render(<StatusPill status="in_transit" map={RETURN_STATUS} />)
    expect(screen.getByText('In transit')).toBeInTheDocument()
  })
})

describe('Countdown (render)', () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0)

  it('renders a dash when there is no deadline', () => {
    render(<Countdown at={null} now={now} />)
    expect(screen.getByText('-')).toBeInTheDocument()
  })

  it('shows time left for a future deadline', () => {
    const at = new Date(now + 3 * 3600_000).toISOString() // 3h ahead
    render(<Countdown at={at} now={now} />)
    expect(screen.getByText('3h 0m left')).toBeInTheDocument()
  })

  it('shows minutes left under an hour', () => {
    const at = new Date(now + 45 * 60_000).toISOString()
    render(<Countdown at={at} now={now} />)
    expect(screen.getByText('45m left')).toBeInTheDocument()
  })

  it('shows an overdue label for a past deadline', () => {
    const at = new Date(now - 20 * 60_000).toISOString()
    render(<Countdown at={at} now={now} />)
    expect(screen.getByText('Overdue 20m')).toBeInTheDocument()
  })
})
