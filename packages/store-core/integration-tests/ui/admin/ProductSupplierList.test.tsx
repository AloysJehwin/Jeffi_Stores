import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, onChange, options }: any) => (
    <select aria-label="supplier" value={value} onChange={e => onChange(e.target.value)}>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}))

import ProductSupplierList, { emptySupplierRow } from '@/components/admin/ProductSupplierList'

const suppliers = [{ id: 's1', name: 'Acme' }, { id: 's2', name: 'Bolt Co' }]
const row = (o: Record<string, any> = {}) => ({ ...emptySupplierRow(), ...o })

describe('ProductSupplierList', () => {
  it('shows the empty hint and adds a blank row', () => {
    const onChange = vi.fn<(...a: any[]) => any>()
    render(<ProductSupplierList suppliers={suppliers} value={[]} onChange={onChange} />)
    expect(screen.getByText(/No suppliers linked yet/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Add supplier/ }))
    expect(onChange).toHaveBeenCalledWith([emptySupplierRow()])
  })

  it('renders a custom note instead of the default', () => {
    render(<ProductSupplierList suppliers={suppliers} value={[]} onChange={() => {}} note="Variant-level" />)
    expect(screen.getByText('Variant-level')).toBeInTheDocument()
  })

  it('highlights the cheapest valid price as Best price', () => {
    render(
      <ProductSupplierList
        suppliers={suppliers}
        value={[row({ supplier_id: 's1', unit_cost: '120' }), row({ supplier_id: 's2', unit_cost: '90' })]}
        onChange={() => {}}
      />
    )
    expect(screen.getAllByText('Best price')).toHaveLength(1)
    const costs = screen.getAllByPlaceholderText('Buy price')
    expect(costs[1].closest('.rounded-lg')?.className).toMatch(/border-accent-400/)
    expect(costs[0].closest('.rounded-lg')?.className).not.toMatch(/border-accent-400/)
  })

  it('marks suppliers already chosen in other rows', () => {
    render(<ProductSupplierList suppliers={suppliers} value={[row({ supplier_id: 's1' }), row()]} onChange={() => {}} />)
    const selects = screen.getAllByLabelText('supplier')
    expect(Array.from(selects[1].querySelectorAll('option')).map(o => o.textContent)).toContain('Acme (added)')
    expect(Array.from(selects[0].querySelectorAll('option')).map(o => o.textContent)).toContain('Acme')
  })

  it('emits edits for supplier, price, MOQ, lead time and notes', () => {
    const onChange = vi.fn<(...a: any[]) => any>()
    render(<ProductSupplierList suppliers={suppliers} value={[row()]} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('supplier'), { target: { value: 's2' } })
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ supplier_id: 's2' })])
    fireEvent.change(screen.getByPlaceholderText('Buy price'), { target: { value: '55' } })
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ unit_cost: '55' })])
    fireEvent.change(screen.getByPlaceholderText('MOQ'), { target: { value: '10' } })
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ moq: '10' })])
    fireEvent.change(screen.getByPlaceholderText('Lead days'), { target: { value: '4' } })
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ lead_time_days: '4' })])
    fireEvent.change(screen.getByPlaceholderText('Notes'), { target: { value: 'net 30' } })
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ notes: 'net 30' })])
  })

  it('sets exactly one preferred supplier', () => {
    const onChange = vi.fn<(...a: any[]) => any>()
    render(<ProductSupplierList suppliers={suppliers} value={[row({ supplier_id: 's1', is_preferred: true }), row({ supplier_id: 's2' })]} onChange={onChange} />)
    fireEvent.click(screen.getAllByTitle('Set as preferred')[0])
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ is_preferred: false }), expect.objectContaining({ is_preferred: true })])
    expect(screen.getByTitle('Preferred supplier')).toBeInTheDocument()
  })

  it('removes a row', () => {
    const onChange = vi.fn<(...a: any[]) => any>()
    render(<ProductSupplierList suppliers={suppliers} value={[row({ supplier_id: 's1' }), row({ supplier_id: 's2' })]} onChange={onChange} />)
    fireEvent.click(screen.getAllByTitle('Remove supplier')[0])
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ supplier_id: 's2' })])
  })
})
