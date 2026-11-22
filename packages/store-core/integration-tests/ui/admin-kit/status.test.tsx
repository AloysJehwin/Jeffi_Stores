import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBadge, humanize, ORDER_STATUS, PAYMENT_STATUS } from '@/components/admin/kit/status'

// Status chips: a known status takes its mapped label, an unknown one is humanised, and `label`
// overrides both. Tooltip wraps the chip only when `title` is given (it renders children inline).

describe('humanize', () => {
  it('capitalises and de-snakes a status, dashes an empty value', () => {
    expect(humanize('out_for_delivery')).toBe('Out for delivery')
    expect(humanize('paid')).toBe('Paid')
    expect(humanize('')).toBe('-')
  })
})

describe('StatusBadge (render + branches)', () => {
  it('uses the mapped label for a known status', () => {
    render(<StatusBadge status="delivered" map={ORDER_STATUS} />)
    expect(screen.getByText('Delivered')).toBeInTheDocument()
  })

  it('humanises an unknown status not in the map', () => {
    render(<StatusBadge status="weird_state" map={ORDER_STATUS} />)
    expect(screen.getByText('Weird state')).toBeInTheDocument()
  })

  it('falls back to a dash when status is null and no map hit', () => {
    render(<StatusBadge status={null} />)
    expect(screen.getByText('-')).toBeInTheDocument()
  })

  it('prefers an explicit label over the map and humanised value', () => {
    render(<StatusBadge status="paid" map={PAYMENT_STATUS} label="Settled" />)
    expect(screen.getByText('Settled')).toBeInTheDocument()
    expect(screen.queryByText('Paid')).toBeNull()
  })

  it('still renders the chip text when wrapped with a title tooltip', () => {
    render(<StatusBadge status="failed" map={PAYMENT_STATUS} title="Gateway declined" />)
    expect(screen.getByText('Failed')).toBeInTheDocument()
  })
})
