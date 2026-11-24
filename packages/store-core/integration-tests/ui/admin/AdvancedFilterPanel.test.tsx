import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const push = vi.fn()
let search = ''
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(search),
}))
vi.mock('@/components/ui/DatePicker', () => ({
  default: ({ value, onChange, placeholder }: any) => (
    <input aria-label={placeholder} value={value} onChange={e => onChange(e.target.value)} />
  ),
}))
vi.mock('@/components/admin/kit/dialog', () => ({
  Sheet: ({ open, title, footer, children }: any) =>
    open ? (
      <div role="dialog" aria-label={title}>
        {children}
        {footer}
      </div>
    ) : null,
}))
vi.mock('@/components/admin/FilterValueHelp', () => ({
  default: ({ field, value, onChange, noun, context }: any) => (
    <div>
      <span data-testid="vh">{field}|{value}|{noun}|{context}</span>
      <button onClick={() => onChange('A;B')}>pick-values</button>
    </div>
  ),
}))
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, options, onChange }: any) => (
    <select aria-label="select" value={value} onChange={e => onChange(e.target.value)}>
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}))
vi.mock('@/components/admin/AdminTypeahead', () => ({
  default: ({ value, onChange, onSelect, placeholder }: any) => (
    <div>
      <input aria-label="typeahead" placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} />
      <button onClick={() => onSelect({ id: 'picked-id' })}>pick-suggestion</button>
    </div>
  ),
}))

import AdvancedFilterPanel, { AdvancedFilterTrigger, chipLabel, fieldIsActive } from '@/components/admin/AdvancedFilterPanel'

const fields: any[] = [
  { name: 'in_stock', label: 'In stock', type: 'boolean', section: 'Stock' },
  { name: 'status', label: 'Status', type: 'toggle', options: [{ value: 'paid', label: 'Paid' }, { value: 'due', label: 'Due' }], section: 'Stock' },
  { name: 'brand', label: 'Brand', type: 'select', options: [{ value: 'acme', label: 'Acme' }], section: 'Catalog' },
  { name: 'colors', label: 'Colours', type: 'multi-select', options: [{ value: 'red', label: 'Red' }, { value: 'blue', label: 'Blue' }], section: 'Catalog' },
  { name: 'price', label: 'Price', type: 'range', unit: '₹', section: 'Catalog' },
  { name: 'created', label: 'Created', type: 'date-range', section: 'Dates' },
  { name: 'sku', label: 'SKU', type: 'text', section: 'Dates' },
  { name: 'customer', label: 'Customer', type: 'text', suggest: 'customers', section: 'Dates' },
  { name: 'tags', label: 'Tags', type: 'value-help', noun: 'Products', section: 'Dates' },
]

const lastPush = () => new URLSearchParams((push.mock.lastCall![0] as string).replace(/^\?/, ''))

describe('chipLabel / fieldIsActive', () => {
  const p = (q: string) => new URLSearchParams(q)
  const f = (o: any) => ({ label: 'L', name: 'n', ...o })

  it('formats range chips', () => {
    expect(chipLabel(f({ type: 'range', unit: '₹' }), p('n_min=10&n_max=20'))).toBe('L: ₹10–₹20')
    expect(chipLabel(f({ type: 'range' }), p('n_min=10'))).toBe('L: ≥10')
    expect(chipLabel(f({ type: 'range' }), p('n_max=20'))).toBe('L: ≤20')
  })

  it('formats date range chips and custom param names', () => {
    expect(chipLabel(f({ type: 'date-range' }), p('n_from=2026-01-01&n_to=2026-02-01'))).toBe('L: 2026-01-01–2026-02-01')
    expect(chipLabel(f({ type: 'date-range' }), p('n_from=2026-01-01'))).toBe('L: from 2026-01-01')
    expect(chipLabel(f({ type: 'date-range', name: ['a', 'b'] }), p('b=2026-03-01'))).toBe('L: to 2026-03-01')
  })

  it('formats boolean, option and text chips', () => {
    expect(chipLabel(f({ type: 'boolean' }), p('n=true'))).toBe('L: Yes')
    expect(chipLabel(f({ type: 'select', options: [{ value: 'a', label: 'Alpha' }] }), p('n=a'))).toBe('L: Alpha')
    expect(chipLabel(f({ type: 'multi-select', options: [{ value: 'a', label: 'Alpha' }] }), p('n=a,b'))).toBe('L: Alpha, b')
    expect(chipLabel(f({ type: 'text' }), p('n=hello'))).toBe('L: hello')
  })

  it('detects active fields across all of their params', () => {
    expect(fieldIsActive(f({ name: ['a', 'b'] }), p('b=1'))).toBe(true)
    expect(fieldIsActive(f({ name: 'a' }), p('x=1'))).toBe(false)
  })
})

describe('AdvancedFilterTrigger', () => {
  it.each([
    [0, false, 'More filters'],
    [0, true, 'Hide filters'],
    [1, false, '1 filter'],
    [3, true, '3 filters'],
  ])('shows the right label for count=%s expanded=%s', (count, expanded, text) => {
    const onToggle = vi.fn()
    render(<AdvancedFilterTrigger activeCount={count} expanded={expanded} onToggle={onToggle} />)
    fireEvent.click(screen.getByRole('button', { name: new RegExp(text) }))
    expect(onToggle).toHaveBeenCalled()
  })
})

describe('AdvancedFilterPanel', () => {
  beforeEach(() => {
    search = ''
  })

  it('trigger mode renders only the toggle button', () => {
    render(<AdvancedFilterPanel fields={fields} mode="trigger" />)
    expect(screen.getByRole('button', { name: /More filters/ })).toBeInTheDocument()
    expect(screen.queryByText('Stock')).toBeNull()
  })

  it('content mode renders nothing when collapsed with no active filters', () => {
    const { container } = render(<AdvancedFilterPanel fields={fields} mode="content" />)
    expect(container.firstChild).toBeNull()
  })

  it('both mode expands to show collapsible sections', () => {
    render(<AdvancedFilterPanel fields={fields} />)
    expect(screen.queryByText('Stock')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /More filters/ }))
    expect(screen.getByRole('button', { name: /Stock/ })).toBeInTheDocument()
    expect(screen.queryByText('In stock')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Stock/ }))
    expect(screen.getByText('In stock')).toBeInTheDocument()
  })

  it('builds the query string from the edited fields and resets the page', () => {
    search = 'search=bob&page=4'
    render(<AdvancedFilterPanel fields={fields} forceExpanded />)
    for (const name of [/Stock/, /Catalog/, /Dates/]) fireEvent.click(screen.getByRole('button', { name }))

    fireEvent.click(screen.getByText('Any', { selector: 'span' }))
    fireEvent.click(screen.getByRole('button', { name: 'Paid' }))
    fireEvent.change(screen.getByLabelText('select'), { target: { value: 'acme' } })
    fireEvent.change(screen.getByPlaceholderText('Min'), { target: { value: '100' } })
    fireEvent.change(screen.getByPlaceholderText('Max'), { target: { value: '900' } })
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-01-01' } })
    fireEvent.change(screen.getByPlaceholderText('Filter by SKU'), { target: { value: 'AB-1' } })
    fireEvent.click(screen.getByText('pick-suggestion'))
    fireEvent.click(screen.getByText('pick-values'))
    fireEvent.click(screen.getByRole('button', { name: 'Apply Filters' }))

    const q = lastPush()
    expect(q.get('search')).toBe('bob')
    expect(q.has('page')).toBe(false)
    expect(q.get('in_stock')).toBe('true')
    expect(q.get('status')).toBe('paid')
    expect(q.get('brand')).toBe('acme')
    expect(q.get('price_min')).toBe('100')
    expect(q.get('price_max')).toBe('900')
    expect(q.get('created_from')).toBe('2026-01-01')
    expect(q.get('sku')).toBe('AB-1')
    expect(q.get('customer')).toBe('picked-id')
    expect(q.get('tags')).toBe('A;B')
  })

  it('multi-select toggles options and joins them', () => {
    render(<AdvancedFilterPanel fields={fields} forceExpanded />)
    fireEvent.click(screen.getByRole('button', { name: /Catalog/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Any' }))
    fireEvent.click(screen.getByRole('button', { name: 'Red' }))
    fireEvent.click(screen.getByRole('button', { name: 'Blue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply Filters' }))
    expect(lastPush().get('colors')).toBe('red|blue')
  })

  it('shows chips for active filters, opening their section, and removes one', () => {
    search = 'status=paid&price_min=10&other=keep&page=2'
    render(<AdvancedFilterPanel fields={fields} />)
    expect(screen.getByText('Status: Paid')).toBeInTheDocument()
    expect(screen.getByText('Price: ≥₹10')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Status: Paid').querySelector('button')!)
    const q = lastPush()
    expect(q.has('status')).toBe(false)
    expect(q.get('price_min')).toBe('10')
    expect(q.get('other')).toBe('keep')
    expect(q.has('page')).toBe(false)
  })

  it('Clear all removes only filter params', () => {
    search = 'status=paid&other=keep'
    render(<AdvancedFilterPanel fields={fields} />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    const q = lastPush()
    expect(q.has('status')).toBe(false)
    expect(q.get('other')).toBe('keep')
  })

  it('Reset All clears edits and URL filters', () => {
    search = 'status=paid'
    render(<AdvancedFilterPanel fields={fields} forceExpanded />)
    fireEvent.click(screen.getByRole('button', { name: 'Reset All' }))
    expect(lastPush().has('status')).toBe(false)
  })

  it('syncs local state from the URL', () => {
    search = 'sku=ZZ-9'
    render(<AdvancedFilterPanel fields={fields} forceExpanded />)
    fireEvent.click(screen.getByRole('button', { name: /Dates/ }))
    expect(screen.getByPlaceholderText('Filter by SKU')).toHaveValue('ZZ-9')
  })

  it('passes the noun and the other picked filters as context to value help', () => {
    search = 'status=paid&search=x&tags=old'
    render(<AdvancedFilterPanel fields={fields} forceExpanded noun="Orders" />)
    fireEvent.click(screen.getByRole('button', { name: /Dates/ }))
    const vh = screen.getByTestId('vh').textContent!
    expect(vh.startsWith('tags|old|Products|')).toBe(true)
    expect(vh).toContain('status=paid')
    expect(vh).not.toContain('search=x')
    expect(vh).not.toContain('tags=old')
  })

  it('sheet mode shows sections in a dialog with Reset and Apply that close it', () => {
    const onClose = vi.fn()
    render(<AdvancedFilterPanel fields={fields} mode="sheet" open onClose={onClose} title="Order filters" />)
    expect(screen.getByRole('dialog', { name: 'Order filters' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Stock/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Due' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(lastPush().get('status')).toBe('due')
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('sheet mode renders nothing while closed', () => {
    render(<AdvancedFilterPanel fields={fields} mode="sheet" open={false} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
