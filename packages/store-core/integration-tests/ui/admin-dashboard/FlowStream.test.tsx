import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FlowStream } from '@/components/admin/dashboard/FlowStream'

describe('FlowStream', () => {
  const flow = { placed: 200, paid: 180, shipped: 150, delivered: 120, cancelled: 12, returned: 3 }

  it('shows each stage value, its share of placed orders and the leaks', () => {
    const { container } = render(<FlowStream flow={flow} />)
    for (const label of ['Placed', 'Paid', 'Shipped', 'Delivered']) expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.getByText('200')).toBeInTheDocument()
    expect(screen.getByText('120')).toBeInTheDocument()
    expect(screen.getByText('60%')).toBeInTheDocument()
    expect(screen.getByText('Cancelled')).toHaveTextContent('Cancelled 12')
    expect(screen.getByText('Returned')).toHaveTextContent('Returned 3')
    expect(container.querySelectorAll('[data-band]')).toHaveLength(3)
  })

  it('renders an empty state when nothing was placed', () => {
    const { container } = render(<FlowStream flow={{ ...flow, placed: 0, paid: 0, shipped: 0, delivered: 0 }} />)
    expect(screen.getByText('No orders placed in this range.')).toBeInTheDocument()
    expect(container.querySelector('svg')).not.toBeInTheDocument()
  })
})
