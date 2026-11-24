import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, onChange, options }: any) => (
    <select aria-label="view" value={value} onChange={e => onChange(e.target.value)}>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}))

import ProductBreakdownChart from '@/components/admin/ProductBreakdownChart'

const props = {
  byCategory: [{ label: 'Tools', value: 30, color: '#111' }, { label: 'Paint', value: 10, color: '#222' }, { label: 'Empty', value: 0, color: '#333' }],
  byBrand: [{ label: 'Acme', value: 5, color: '#444' }],
  byStock: [],
  byInventoryValue: [{ label: 'Hammer', value: 123456.7, color: '#555' }],
} as any

describe('ProductBreakdownChart', () => {
  it('shows category rows with share, dropping zero values', () => {
    render(<ProductBreakdownChart {...props} />)
    expect(screen.getByText('Product Breakdown')).toBeInTheDocument()
    expect(screen.getByText('Tools')).toBeInTheDocument()
    expect(screen.getByText('(75%)')).toBeInTheDocument()
    expect(screen.getByText('(25%)')).toBeInTheDocument()
    expect(screen.queryByText('Empty')).not.toBeInTheDocument()
  })

  it('switches to brand instantly', () => {
    render(<ProductBreakdownChart {...props} />)
    fireEvent.change(screen.getByLabelText('view'), { target: { value: 'brand' } })
    expect(screen.getByText('Acme')).toBeInTheDocument()
    expect(screen.queryByText('Tools')).not.toBeInTheDocument()
  })

  it('shows "No data" for an empty dataset', () => {
    render(<ProductBreakdownChart {...props} />)
    fireEvent.change(screen.getByLabelText('view'), { target: { value: 'stock' } })
    expect(screen.getByText('No data')).toBeInTheDocument()
  })

  it('formats inventory value as rupees without a percent share', () => {
    render(<ProductBreakdownChart {...props} />)
    fireEvent.change(screen.getByLabelText('view'), { target: { value: 'inventory' } })
    expect(screen.getByText('Rs. 1,23,457')).toBeInTheDocument()
    expect(screen.queryByText(/%\)/)).not.toBeInTheDocument()
  })
})
