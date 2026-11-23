import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Select, { MultiSelect, type Option } from '@/components/ui/Select'

const opts: Option<string>[] = [
  { value: 'a', label: 'Apple' },
  { value: 'b', label: 'Banana' },
  { value: 'c', label: 'Cherry', disabled: true },
]

describe('Select (render + selection)', () => {
  it('renders the placeholder when nothing matches the value', () => {
    render(<Select value="" onChange={() => {}} options={opts} placeholder="Pick fruit" aria-label="fruit" />)
    expect(screen.getByRole('combobox')).toHaveTextContent('Pick fruit')
  })

  it('renders the selected option label', () => {
    render(<Select value="b" onChange={() => {}} options={opts} aria-label="fruit" />)
    expect(screen.getByRole('combobox')).toHaveTextContent('Banana')
  })

  it('opens the listbox on click and shows the options', async () => {
    render(<Select value="" onChange={() => {}} options={opts} aria-label="fruit" />)
    fireEvent.click(screen.getByRole('combobox'))
    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument())
    expect(screen.getByRole('option', { name: 'Apple' })).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'true')
  })

  it('fires onChange with the picked value and closes', async () => {
    const onChange = vi.fn()
    render(<Select value="" onChange={onChange} options={opts} aria-label="fruit" />)
    fireEvent.click(screen.getByRole('combobox'))
    await waitFor(() => screen.getByRole('listbox'))
    fireEvent.click(screen.getByRole('option', { name: 'Apple' }))
    expect(onChange).toHaveBeenCalledWith('a')
  })

  it('does not select a disabled option', async () => {
    const onChange = vi.fn()
    render(<Select value="" onChange={onChange} options={opts} aria-label="fruit" />)
    fireEvent.click(screen.getByRole('combobox'))
    await waitFor(() => screen.getByRole('listbox'))
    fireEvent.click(screen.getByRole('option', { name: 'Cherry' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not open when disabled', () => {
    render(<Select value="" onChange={() => {}} options={opts} aria-label="fruit" disabled />)
    const trigger = screen.getByRole('combobox')
    expect(trigger).toBeDisabled()
    fireEvent.click(trigger)
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})

describe('MultiSelect (render + toggle)', () => {
  it('renders placeholder with an empty selection', () => {
    render(<MultiSelect value={[]} onChange={() => {}} options={opts} placeholder="Choose" aria-label="fruits" />)
    expect(screen.getByRole('combobox')).toHaveTextContent('Choose')
  })

  it('renders chips for the selected values', () => {
    render(<MultiSelect value={['a', 'b']} onChange={() => {}} options={opts} aria-label="fruits" />)
    const trigger = screen.getByRole('combobox')
    expect(trigger).toHaveTextContent('Apple')
    expect(trigger).toHaveTextContent('Banana')
  })

  it('adds a value on option click (toggle on)', async () => {
    const onChange = vi.fn()
    render(<MultiSelect value={[]} onChange={onChange} options={opts} aria-label="fruits" />)
    fireEvent.click(screen.getByRole('combobox'))
    await waitFor(() => screen.getByRole('listbox'))
    fireEvent.click(screen.getByRole('option', { name: /Apple/ }))
    expect(onChange).toHaveBeenCalledWith(['a'])
  })

  it('removes a value via the chip remove button', () => {
    const onChange = vi.fn()
    render(<MultiSelect value={['a', 'b']} onChange={onChange} options={opts} aria-label="fruits" />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Apple' }))
    expect(onChange).toHaveBeenCalledWith(['b'])
  })
})
