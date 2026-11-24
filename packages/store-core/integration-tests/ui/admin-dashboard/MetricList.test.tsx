import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MetricList } from '@/components/admin/dashboard/MetricList'

const metrics = [
  { label: 'Avg time to ship', value: '1.8 d', hint: 'placed to shipped' },
  { label: 'RTO rate', value: '4%', delta: -2, invertDelta: true },
]

describe('MetricList', () => {
  it('lists label, value and hint, with a delta chip only where given', () => {
    render(<MetricList metrics={metrics} />)
    expect(screen.getByText('Avg time to ship')).toBeInTheDocument()
    expect(screen.getByText('1.8 d')).toBeInTheDocument()
    expect(screen.getByText('placed to shipped')).toBeInTheDocument()
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveAttribute('data-tone', 'good')
  })

  it('switches tabs through the callback', () => {
    const onTabChange = vi.fn()
    render(
      <MetricList
        metrics={metrics}
        tabs={[
          { value: 'all', label: 'All' },
          { value: 'cod', label: 'COD' },
        ]}
        tab="all"
        onTabChange={onTabChange}
      />
    )
    fireEvent.click(screen.getByRole('radio', { name: 'COD' }))
    expect(onTabChange).toHaveBeenCalledWith('cod')
  })

  it('renders an empty state', () => {
    render(<MetricList metrics={[]} />)
    expect(screen.getByText('No fulfilment data yet.')).toBeInTheDocument()
  })
})
