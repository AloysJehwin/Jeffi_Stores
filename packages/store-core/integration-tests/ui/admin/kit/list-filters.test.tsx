import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, renderHook } from '@testing-library/react'

const push = vi.fn()
const replace = vi.fn()
let search = ''
let spCache: { s: string; v: URLSearchParams } = { s: '', v: new URLSearchParams() }
const stableSp = () => (spCache.s === search ? spCache.v : (spCache = { s: search, v: new URLSearchParams(search) }).v)
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => stableSp(),
  usePathname: () => '/admin/orders',
}))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
vi.mock('@/components/ui/Select', () => ({
  default: ({ value, options, onChange, placeholder }: any) => (
    <select aria-label={placeholder} value={value} onChange={e => onChange(e.target.value)}>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}))
vi.mock('@/components/admin/AdminTypeahead', () => ({ default: () => <input aria-label="typeahead" /> }))
vi.mock('@/components/admin/AdvancedFilterPanel', () => ({
  default: ({ mode, open, title }: any) => (mode === 'sheet' ? (open ? <div role="dialog" aria-label={title}>sheet panel</div> : null) : <div>advanced panel</div>),
  chipLabel: (f: any, p: URLSearchParams) => `${f.label}=${p.get(Array.isArray(f.name) ? f.name[0] : f.name)}`,
  fieldIsActive: (f: any, p: URLSearchParams) => !!p.get(Array.isArray(f.name) ? f.name[0] : f.name),
}))
vi.mock('@/components/admin/kit/saved-views', () => ({
  SavedViewsMenu: () => <button>Views menu</button>,
  ShareFilterLink: () => <button>Share link</button>,
}))
vi.mock('@/components/admin/export/ExportButton', () => ({
  ExportButton: () => <button>Export rows</button>,
}))

import { ListFilters, useFilterQuery } from '@/components/admin/kit/list-filters'

const fields: any[] = [
  { name: 'status', label: 'Status', type: 'select', quick: true, options: [{ value: 'paid', label: 'Paid' }, { value: 'cod', label: 'COD' }] },
  { name: 'city', label: 'City', type: 'text' },
  { name: ['from', 'to'], label: 'Created', type: 'date' },
]

beforeEach(() => {
  search = ''
  push.mockClear()
  replace.mockClear()
  window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} })) as any
})

describe('ListFilters', () => {
  it('renders the search, quick select, Filters toggle and the saved-view controls', () => {
    render(<ListFilters entity="orders" fields={fields} search={{ placeholder: 'Search orders' }} exportable />)
    expect(screen.getByRole('textbox', { name: 'Search' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Status' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Filters/ }).length).toBeGreaterThan(0)
    expect(screen.getByText('Views menu')).toBeInTheDocument()
    expect(screen.getByText('Share link')).toBeInTheDocument()
    expect(screen.getByText('Export rows')).toBeInTheDocument()
  })

  it('hides views, share and export when turned off', () => {
    render(<ListFilters entity="orders" fields={fields} views={false} share={false} />)
    expect(screen.queryByText('Views menu')).toBeNull()
    expect(screen.queryByText('Share link')).toBeNull()
    expect(screen.queryByText('Export rows')).toBeNull()
  })

  it('a quick select writes its param', () => {
    render(<ListFilters entity="orders" fields={fields} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'cod' } })
    expect(push).toHaveBeenCalledWith('/admin/orders?status=cod')
  })

  it('shows a chip per active filter and removing one drops its params and the page', () => {
    search = 'status=paid&city=Pune&page=3'
    render(<ListFilters entity="orders" fields={fields} />)
    expect(screen.getByText('Status=paid')).toBeInTheDocument()
    expect(screen.getByText('City=Pune')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove City filter' }))
    expect(push).toHaveBeenCalledWith('/admin/orders?status=paid')
  })

  it('counts active advanced filters on the Filters button and toggles the panel', () => {
    search = 'city=Pune'
    render(<ListFilters entity="orders" fields={fields} />)
    const toggle = screen.getAllByRole('button', { name: /Filters/ })[0]
    expect(toggle).toHaveTextContent('Filters · 1')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('advanced panel')).toBeNull()
    fireEvent.click(toggle)
    expect(screen.getByText('advanced panel')).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
  })

  it('opens the filter sheet from the mobile button', () => {
    search = 'city=Pune'
    render(<ListFilters entity="orders" fields={fields} />)
    expect(screen.queryByRole('dialog', { name: 'Filters' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Filters (1)' }))
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument()
  })

  it('on an overview tab the period owns the date field', () => {
    search = 'from=2026-01-01'
    render(<ListFilters entity="orders" fields={fields} period />)
    expect(screen.queryByText(/^Created=/)).toBeNull()
  })

  it('rewrites an old alias param and pins the tab with a replace', () => {
    search = 'old=paid'
    render(<ListFilters entity="orders" fields={fields} tab="all" aliases={[{ param: 'old', to: 'status' }]} />)
    expect(replace).toHaveBeenCalledTimes(1)
    const url = replace.mock.calls[0][0] as string
    expect(url).toContain('status=paid')
    expect(url).toContain('tab=all')
    expect(replace.mock.calls[0][1]).toEqual({ scroll: false })
  })

  it('does not replace the URL when nothing needs rewriting', () => {
    search = 'status=paid&tab=all'
    render(<ListFilters entity="orders" fields={fields} tab="all" />)
    expect(replace).not.toHaveBeenCalled()
  })

  it('shows an N selected option for a multi-value quick filter', () => {
    search = 'status=paid|cod'
    render(<ListFilters entity="orders" fields={fields} />)
    expect(screen.getByRole('option', { name: 'Status: 2 selected' })).toBeInTheDocument()
  })
})

describe('useFilterQuery', () => {
  it('builds the canonical query from the URL, omitting what is asked', () => {
    search = 'status=paid&city=Pune&page=2&search=shirt'
    const { result } = renderHook(() => useFilterQuery(fields, { omit: ['city'] }))
    const q = new URLSearchParams(result.current)
    expect(q.get('status')).toBe('paid')
    expect(q.get('city')).toBeNull()
    expect(q.get('page')).toBeNull()
    expect(q.get('search')).toBe('shirt')
  })

  it('leaves the search out when search is false', () => {
    search = 'search=shirt&status=paid'
    const { result } = renderHook(() => useFilterQuery(fields, { search: false }))
    expect(new URLSearchParams(result.current).get('search')).toBeNull()
  })
})
