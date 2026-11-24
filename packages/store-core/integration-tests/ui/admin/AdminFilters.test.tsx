import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const push = vi.fn()
let search = ''
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => '/admin/orders',
}))
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ id, value, options, onChange }: any) => (
    <select id={id} value={value} onChange={e => onChange(e.target.value)}>
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}))
vi.mock('@/components/admin/AdminTypeahead', () => ({
  default: ({ value, onChange, onSelect, onEnter, placeholder }: any) => (
    <div>
      <input aria-label="typeahead" value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
      <button onClick={() => onSelect({ href: '/admin/orders/9' })}>pick-href</button>
      <button onClick={() => onSelect({})}>pick-plain</button>
      <button onClick={() => onEnter(' abc ')}>enter</button>
    </div>
  ),
}))

import AdminFilters from '@/components/admin/AdminFilters'

const filters = [
  { name: 'status', label: 'Status', options: [{ value: 'paid', label: 'Paid' }], allLabel: 'Any status' },
]

describe('AdminFilters', () => {
  beforeEach(() => {
    search = ''
  })

  it('renders each filter with its all-label and no Clear button initially', () => {
    render(<AdminFilters filters={filters} />)
    expect(screen.getByLabelText('Status')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Any status' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear Filters' })).toBeNull()
  })

  it('pushes the chosen filter to the URL and resets the page', () => {
    search = 'page=3'
    render(<AdminFilters filters={filters} />)
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'paid' } })
    expect(push).toHaveBeenCalledWith('/admin/orders?status=paid')
  })

  it('clearing a filter drops the param', () => {
    search = 'status=paid&x=1'
    render(<AdminFilters filters={filters} />)
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: '' } })
    expect(push).toHaveBeenCalledWith('/admin/orders?x=1')
  })

  it('submits the plain search form with a trimmed value', () => {
    render(<AdminFilters filters={[]} searchPlaceholder="Search orders" />)
    const input = screen.getByPlaceholderText('Search orders')
    fireEvent.change(input, { target: { value: '  ord-1 ' } })
    fireEvent.submit(input.closest('form')!)
    expect(push).toHaveBeenCalledWith('/admin/orders?search=ord-1')
  })

  it('uses a custom search param', () => {
    render(<AdminFilters filters={[]} searchPlaceholder="Find" searchParam="q" />)
    const input = screen.getByPlaceholderText('Find')
    fireEvent.change(input, { target: { value: 'x' } })
    fireEvent.submit(input.closest('form')!)
    expect(push).toHaveBeenCalledWith('/admin/orders?q=x')
  })

  it('shows the active count and clears everything', () => {
    search = 'status=paid&search=bob'
    render(<AdminFilters filters={filters} searchPlaceholder="Search" />)
    expect(screen.getByText('2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear Filters' }))
    expect(push).toHaveBeenCalledWith('/admin/orders')
  })

  it('typeahead: selecting an item with an href navigates to it', () => {
    render(<AdminFilters filters={[]} searchPlaceholder="Search" suggestType="orders" />)
    fireEvent.click(screen.getByText('pick-href'))
    expect(push).toHaveBeenCalledWith('/admin/orders/9')
  })

  it('typeahead: a plain selection and Enter search by text', () => {
    render(<AdminFilters filters={[]} searchPlaceholder="Search" suggestType="orders" />)
    fireEvent.change(screen.getByLabelText('typeahead'), { target: { value: ' bob ' } })
    fireEvent.click(screen.getByText('pick-plain'))
    expect(push).toHaveBeenLastCalledWith('/admin/orders?search=bob')
    fireEvent.click(screen.getByText('enter'))
    expect(push).toHaveBeenLastCalledWith('/admin/orders?search=abc')
  })

  it('reveals advanced content only after toggling', () => {
    render(<AdminFilters filters={[]} advancedContent={<p>Advanced panel</p>} />)
    expect(screen.queryByText('Advanced panel')).toBeNull()
    const toggle = screen.getAllByRole('button').at(-1)!
    fireEvent.click(toggle)
    expect(screen.getByText('Advanced panel')).toBeInTheDocument()
    fireEvent.click(toggle)
    expect(screen.queryByText('Advanced panel')).toBeNull()
  })

  it('bare drops the card chrome', () => {
    const { container } = render(<AdminFilters filters={filters} bare />)
    expect(container.firstChild).not.toHaveClass('sticky')
  })
})
