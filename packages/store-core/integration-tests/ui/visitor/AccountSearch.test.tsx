import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'

import AccountSearch from '@/components/visitor/AccountSearch'

const SUGGESTIONS = ['Order #1001', 'Order #1002', 'Refund request', 'ORDER archive']

function Harness({ onChange = vi.fn(), initial = '' }: { onChange?: (v: string) => void; initial?: string }) {
  const [v, setV] = useState(initial)
  return (
    <AccountSearch
      placeholder="Search orders"
      suggestions={SUGGESTIONS}
      value={v}
      onChange={x => {
        setV(x)
        onChange(x)
      }}
    />
  )
}

describe('AccountSearch', () => {
  it('shows no suggestions and no clear button for an empty value', () => {
    render(<Harness />)
    fireEvent.focus(screen.getByPlaceholderText('Search orders'))
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('filters suggestions case-insensitively as the user types', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.change(screen.getByPlaceholderText('Search orders'), { target: { value: 'order' } })
    expect(onChange).toHaveBeenCalledWith('order')
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.queryByText('Refund request')).not.toBeInTheDocument()
  })

  it('picks a suggestion on mousedown and closes the list', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.change(screen.getByPlaceholderText('Search orders'), { target: { value: 'refund' } })
    fireEvent.mouseDown(screen.getByText('Refund request'))
    expect(onChange).toHaveBeenLastCalledWith('Refund request')
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search orders')).toHaveValue('Refund request')
  })

  it('shows nothing when no suggestion matches', () => {
    render(<Harness />)
    fireEvent.change(screen.getByPlaceholderText('Search orders'), { target: { value: 'zzz' } })
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('clears the value with the clear button', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} initial="Order" />)
    fireEvent.click(screen.getByRole('button'))
    expect(onChange).toHaveBeenLastCalledWith('')
    expect(screen.getByPlaceholderText('Search orders')).toHaveValue('')
  })

  it('closes the list on an outside mousedown', () => {
    render(<Harness />)
    fireEvent.change(screen.getByPlaceholderText('Search orders'), { target: { value: 'order' } })
    expect(screen.getByRole('list')).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    fireEvent.focus(screen.getByPlaceholderText('Search orders'))
    expect(screen.getByRole('list')).toBeInTheDocument()
  })

  it('caps suggestions at 8', () => {
    const many = Array.from({ length: 12 }, (_, i) => `item ${i}`)
    render(<AccountSearch placeholder="s" suggestions={many} value="item" onChange={vi.fn()} />)
    fireEvent.focus(screen.getByPlaceholderText('s'))
    expect(screen.getAllByRole('listitem')).toHaveLength(8)
  })
})
