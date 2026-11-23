import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ColumnMapper, { type MapperField } from '@/components/admin/marketplace/ColumnMapper'

// Report-header mapper: one AdminSelect per field. Emits the full mapping on every change,
// flags required-but-unmapped fields and duplicate header assignments, and shows a sample
// value for a mapped header.

const fields: MapperField[] = [
  { key: 'date', label: 'Date', required: true },
  { key: 'spend', label: 'Spend', required: true, hint: 'In rupees' },
  { key: 'notes', label: 'Notes' },
]
const headers = ['Day', 'Cost', 'Memo']

describe('ColumnMapper (render + mapping)', () => {
  it('renders a labelled select per field with the required marker', () => {
    render(<ColumnMapper fields={fields} headers={headers} value={{}} onChange={() => {}} />)
    expect(screen.getByText('Date *')).toBeInTheDocument()
    expect(screen.getByText('Spend *')).toBeInTheDocument()
    // Non-required field has no asterisk.
    expect(screen.getByText('Notes')).toBeInTheDocument()
    expect(screen.queryByText('Notes *')).toBeNull()
  })

  it('shows "Required" on an unmapped required field only', () => {
    render(<ColumnMapper fields={fields} headers={headers} value={{}} onChange={() => {}} />)
    // Two required fields unmapped -> two Required errors.
    expect(screen.getAllByText('Required')).toHaveLength(2)
  })

  it('shows the hint for an unmapped field that has one', () => {
    render(<ColumnMapper fields={fields} headers={headers} value={{}} onChange={() => {}} />)
    expect(screen.getByText('In rupees')).toBeInTheDocument()
  })

  it('shows a sample value in place of the hint when the field is mapped', () => {
    render(
      <ColumnMapper
        fields={fields}
        headers={headers}
        value={{ spend: 'Cost' }}
        samples={{ Cost: '₹123' }}
        onChange={() => {}}
      />
    )
    expect(screen.getByText('e.g. ₹123')).toBeInTheDocument()
    // Hint is replaced by the sample.
    expect(screen.queryByText('In rupees')).toBeNull()
  })

  it('flags a header mapped to two fields as a duplicate', () => {
    render(<ColumnMapper fields={fields} headers={headers} value={{ date: 'Day', spend: 'Day' }} onChange={() => {}} />)
    expect(screen.getAllByText('Also mapped to another field')).toHaveLength(2)
  })

  it('emits the full mapping with the new header set when a select changes', () => {
    const onChange = vi.fn<(...a: any[]) => any>()
    render(<ColumnMapper fields={fields} headers={headers} value={{ spend: 'Cost' }} onChange={onChange} />)
    // Open the Date select (its button shows the placeholder "Not in this file" since unmapped).
    const combos = screen.getAllByRole('combobox')
    fireEvent.click(combos[0])
    fireEvent.click(screen.getByRole('option', { name: 'Day' }))
    // Full mapping preserved + new key set; unset fields are null.
    expect(onChange).toHaveBeenCalledWith({ date: 'Day', spend: 'Cost', notes: null })
  })

  it('maps the empty "Not in this file" option back to null', () => {
    const onChange = vi.fn<(...a: any[]) => any>()
    render(<ColumnMapper fields={fields} headers={headers} value={{ date: 'Day' }} onChange={onChange} />)
    const combos = screen.getAllByRole('combobox')
    fireEvent.click(combos[0])
    fireEvent.click(screen.getByRole('option', { name: 'Not in this file' }))
    expect(onChange).toHaveBeenCalledWith({ date: null, spend: null, notes: null })
  })
})
