import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ThroughputLines } from '@/components/admin/dashboard/ThroughputLines'
import { makeActivity } from './fixtures'

describe('ThroughputLines', () => {
  const a = makeActivity(5)

  it('draws placed (dashed) and shipped lines and the backlog badge', () => {
    const { container } = render(<ThroughputLines throughput={a.throughput} backlog={a.backlog} />)
    expect(container.querySelector('[data-line="shipped"]')).toBeInTheDocument()
    expect(container.querySelector('[data-line="placed"]')!.getAttribute('stroke-dasharray')).toBe('4 4')
    expect(screen.getByText('Backlog 7')).toBeInTheDocument()
  })

  it('shows the week card on hover and by keyboard', () => {
    const { container } = render(<ThroughputLines throughput={a.throughput} backlog={0} />)
    fireEvent.pointerEnter(container.querySelector('[data-zone="2"]')!)
    let tip = screen.getByRole('tooltip')
    expect(within(tip).getByText(/Week of/)).toBeInTheDocument()
    expect(within(tip).getByText('22', { selector: 'span.font-semibold' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('group'), { key: 'End' })
    tip = screen.getByRole('tooltip')
    expect(within(tip).getByText('26')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('group'), { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('renders an empty state with no activity', () => {
    render(<ThroughputLines throughput={a.throughput.map(t => ({ ...t, placed: 0, shipped: 0 }))} backlog={3} />)
    expect(screen.getByText('No weekly activity yet.')).toBeInTheDocument()
    expect(screen.getByText('Backlog 3')).toBeInTheDocument()
  })
})
