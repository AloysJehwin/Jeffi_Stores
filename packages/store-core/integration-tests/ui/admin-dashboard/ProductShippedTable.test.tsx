import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { ProductShippedTable } from '@/components/admin/dashboard/ProductShippedTable'
import { makeActivity } from './fixtures'

describe('ProductShippedTable', () => {
  it('renders a row per product with formatted figures and 8 mini bars', () => {
    const { container } = render(<ProductShippedTable products={makeActivity().topProducts} />)
    const rows = screen.getAllByRole('row')
    expect(rows).toHaveLength(3)
    const first = within(rows[1])
    expect(first.getByText('Linen shirt')).toBeInTheDocument()
    expect(first.getByText('41')).toBeInTheDocument()
    expect(first.getByText('96%')).toBeInTheDocument()
    expect(first.getByText('1.4d')).toBeInTheDocument()
    expect(first.getByRole('img', { name: 'Last 8 weeks: 1, 2, 3, 4, 5, 6, 7, 8' })).toBeInTheDocument()
    expect(container.querySelectorAll('[data-mini]')).toHaveLength(16)
  })

  it('shows dashes for unknown on-time and average days', () => {
    render(<ProductShippedTable products={makeActivity().topProducts} />)
    expect(within(screen.getAllByRole('row')[2]).getAllByText('–')).toHaveLength(2)
  })

  it('renders an empty state', () => {
    render(<ProductShippedTable products={[]} />)
    expect(screen.getByText('No products shipped in this range.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
