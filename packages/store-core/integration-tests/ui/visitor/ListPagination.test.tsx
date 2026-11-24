import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import Pagination from '@/components/visitor/ListPagination'

describe('ListPagination', () => {
  it('renders nothing when everything fits on one page', () => {
    const { container } = render(<Pagination page={1} total={10} pageSize={10} onChange={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the range, page count and disables Prev on the first page', () => {
    const onChange = vi.fn()
    render(<Pagination page={1} total={25} pageSize={10} onChange={onChange} />)
    expect(screen.getByText('1–10 of 25')).toBeInTheDocument()
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Prev' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(onChange).toHaveBeenCalledWith(2)
  })

  it('clamps the last range, goes back, and disables Next on the last page', () => {
    const onChange = vi.fn()
    render(<Pagination page={3} total={25} pageSize={10} onChange={onChange} />)
    expect(screen.getByText('21–25 of 25')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Prev' }))
    expect(onChange).toHaveBeenCalledWith(2)
  })

  it('disables both buttons while busy', () => {
    render(<Pagination page={2} total={25} pageSize={10} onChange={vi.fn()} busy />)
    expect(screen.getByRole('button', { name: 'Prev' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('formats large totals with Indian grouping', () => {
    render(<Pagination page={1} total={123456} pageSize={50} onChange={vi.fn()} />)
    expect(screen.getByText('1–50 of 1,23,456')).toBeInTheDocument()
  })
})
