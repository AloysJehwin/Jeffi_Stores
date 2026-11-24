import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

const push = vi.fn()
let search = ''
let spCache: { s: string; v: URLSearchParams } = { s: '', v: new URLSearchParams() }
const stableSp = () => (spCache.s === search ? spCache.v : (spCache = { s: search, v: new URLSearchParams(search) }).v)
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => stableSp(),
  usePathname: () => '/admin/things',
}))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
vi.mock('@/components/ui/Select', () => ({
  default: ({ value, options, onChange, placeholder }: any) => (
    <select aria-label={placeholder} value={value} onChange={e => onChange(e.target.value)}>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}))
let confirmResult = true
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => () => Promise.resolve(confirmResult) }))
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => true }))
vi.mock('@/components/admin/RowActions', () => ({
  default: ({ actions }: any) => (
    <div>
      {actions.map((a: any) => <button key={a.key} onClick={a.onSelect}>{a.label}</button>)}
    </div>
  ),
}))

import { DataTable, DataToolbar, type DataCol } from '@/components/admin/kit/data-table'

type R = { id: string; name: string; qty: number }
const rows: R[] = [
  { id: '1', name: 'Bravo', qty: 5 },
  { id: '2', name: 'Alpha', qty: 20 },
  { id: '3', name: 'Charlie', qty: 1 },
]
const cols: DataCol<R>[] = [
  { key: 'name', label: 'Name', render: r => r.name, sort: r => r.name },
  { key: 'qty', label: 'Qty', render: r => String(r.qty), sort: r => r.qty, num: true },
]
const names = () => screen.getAllByRole('row').slice(1).map(r => within(r).getAllByRole('cell')[0].textContent)

function media(matches: boolean) {
  window.matchMedia = ((q: string) => ({ matches, media: q, addEventListener() {}, removeEventListener() {} })) as any
}

beforeEach(() => {
  search = ''
  push.mockClear()
  confirmResult = true
  media(true)
})

describe('DataTable (client mode)', () => {
  it('renders rows and headers', () => {
    render(<DataTable rows={rows} cols={cols} rowKey={r => r.id} />)
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument()
    expect(names()).toEqual(['Bravo', 'Alpha', 'Charlie'])
  })

  it('writes the sort to the URL on a header click and sorts in memory from ?sort', () => {
    const { rerender } = render(<DataTable rows={rows} cols={cols} rowKey={r => r.id} />)
    fireEvent.click(screen.getByRole('columnheader', { name: 'Name' }))
    expect(push).toHaveBeenCalledWith('/admin/things?sort=name&dir=asc', { scroll: false })
    search = 'sort=name&dir=asc'
    rerender(<DataTable rows={rows} cols={cols} rowKey={r => r.id} />)
    expect(names()).toEqual(['Alpha', 'Bravo', 'Charlie'])
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('aria-sort', 'ascending')
    search = 'sort=qty&dir=desc'
    rerender(<DataTable rows={rows} cols={cols} rowKey={r => r.id} />)
    expect(names()).toEqual(['Alpha', 'Bravo', 'Charlie'])
    expect(screen.getByRole('columnheader', { name: 'Qty' })).toHaveAttribute('aria-sort', 'descending')
  })

  it('filters rows with the search box', () => {
    render(<DataTable rows={rows} cols={cols} rowKey={r => r.id} search={{ placeholder: 'Find', match: r => r.name }} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'alp' } })
    expect(names()).toEqual(['Alpha'])
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'zzz' } })
    expect(screen.getByText('Nothing here yet.')).toBeInTheDocument()
  })

  it('shows the loading skeleton, an error and a custom empty state', () => {
    const { rerender } = render(<DataTable rows={rows} cols={cols} rowKey={r => r.id} loading />)
    expect(screen.queryByRole('table')).toBeNull()
    rerender(<DataTable rows={rows} cols={cols} rowKey={r => r.id} error="Server down" />)
    expect(screen.getByText('Could not load this')).toBeInTheDocument()
    expect(screen.getByText('Server down')).toBeInTheDocument()
    rerender(<DataTable rows={[]} cols={cols} rowKey={r => r.id} empty={{ title: 'No things', body: 'Add one' }} />)
    expect(screen.getByText('No things')).toBeInTheDocument()
    expect(screen.getByText('Add one')).toBeInTheDocument()
    rerender(<DataTable rows={[]} cols={cols} rowKey={r => r.id} empty="Plain empty" />)
    expect(screen.getByText('Plain empty')).toBeInTheDocument()
  })

  it('calls onRowClick but not from the row action cell', () => {
    const onRowClick = vi.fn()
    const act = vi.fn()
    render(<DataTable rows={rows} cols={cols} rowKey={r => r.id} onRowClick={onRowClick} rowActions={r => [{ key: 'x', label: `Act ${r.name}`, onSelect: act }]} />)
    fireEvent.click(screen.getByText('Alpha'))
    expect(onRowClick).toHaveBeenCalledWith(rows[1])
    fireEvent.click(screen.getByRole('button', { name: 'Act Alpha' }))
    expect(act).toHaveBeenCalledTimes(1)
    expect(onRowClick).toHaveBeenCalledTimes(1)
  })

  it('hides rows the caller removed', () => {
    render(<DataTable rows={rows} cols={cols} rowKey={r => r.id} hide={r => r.id === '2'} />)
    expect(names()).toEqual(['Bravo', 'Charlie'])
  })

  it('pages an embedded list with the arrows', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: String(i), name: `N${i}`, qty: i }))
    render(<DataTable rows={many} cols={cols} rowKey={r => r.id} paged pageSize={5} noun="things" />)
    expect(names()).toEqual(['N0', 'N1', 'N2', 'N3', 'N4'])
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(names()).toEqual(['N5', 'N6', 'N7', 'N8', 'N9'])
    expect(screen.getByText(/things/)).toBeInTheDocument()
  })

  it('reveals more rows with Load more', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: String(i), name: `N${i}`, qty: i }))
    render(<DataTable rows={many} cols={cols} rowKey={r => r.id} pageSize={10} noun="things" />)
    expect(names()).toHaveLength(10)
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(names()).toHaveLength(20)
  })

  it('renders the mobile card layout when the viewport is narrow', () => {
    media(false)
    render(<DataTable rows={rows} cols={cols} rowKey={r => r.id} mobileCard={r => <article>{`card ${r.name}`}</article>} />)
    expect(screen.getByText('card Alpha')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })
})

describe('DataTable selection and bulk actions', () => {
  it('selects rows and runs a confirmed bulk action, then clears the selection', async () => {
    const onRun = vi.fn().mockResolvedValue(undefined)
    render(<DataTable rows={rows} cols={cols} rowKey={r => r.id} selectable bulkActions={[{ key: 'del', label: 'Delete', danger: true, confirm: 'Delete these?', onRun }]} />)
    expect(screen.queryByText(/selected/)).toBeNull()
    const boxes = screen.getAllByRole('checkbox', { name: 'Select row' })
    fireEvent.click(boxes[0])
    fireEvent.click(boxes[2])
    expect(screen.getByText(/2 selected/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await vi.waitFor(() => expect(onRun).toHaveBeenCalledWith([rows[0], rows[2]]))
    await vi.waitFor(() => expect(screen.queryByText(/selected/)).toBeNull())
  })

  it('does not run the action when the confirmation is declined', async () => {
    confirmResult = false
    const onRun = vi.fn()
    render(<DataTable rows={rows} cols={cols} rowKey={r => r.id} selectable bulkActions={[{ key: 'del', label: 'Delete', confirm: 'Sure?', onRun }]} />)
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Select row' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await Promise.resolve()
    await Promise.resolve()
    expect(onRun).not.toHaveBeenCalled()
    expect(screen.getByText(/1 selected/)).toBeInTheDocument()
  })

  it('select-all toggles every loaded row and Clear selection resets', () => {
    render(<DataTable rows={rows} cols={cols} rowKey={r => r.id} selectable bulkActions={[{ key: 'a', label: 'Act', onRun: () => {} }]} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all loaded rows' }))
    expect(screen.getByText(/3 selected/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all loaded rows' }))
    expect(screen.queryByText(/selected/)).toBeNull()
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Select row' })[1])
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(screen.queryByText(/selected/)).toBeNull()
  })
})

describe('DataTable infinite source', () => {
  it('shows the first-page error with a Retry that calls it', () => {
    const retry = vi.fn()
    render(<DataTable rows={[]} cols={cols} rowKey={r => r.id} infinite={{ total: null, hasMore: false, loadingMore: false, error: 'Network failed', loadMore: vi.fn(), retry }} />)
    expect(screen.getByText('Network failed')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('shows the loaded rows with a total in the footer', () => {
    render(<DataTable rows={rows} cols={cols} rowKey={r => r.id} noun="items" infinite={{ total: 40, hasMore: true, loadingMore: false, error: null, loadMore: vi.fn() }} />)
    expect(names()).toHaveLength(3)
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 3 of 40 items')
  })
})

describe('DataTable server mode and DataToolbar', () => {
  it('renders the server page and a toolbar whose search writes ?search', () => {
    render(<DataTable mode="server" rows={rows} cols={[{ ...cols[0], sortParam: 'name' }, cols[1]]} rowKey={r => r.id} total={3} page={1} pageSize={25} search={{ placeholder: 'Search things' }} />)
    expect(names()).toEqual(['Bravo', 'Alpha', 'Charlie'])
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: ' bra ' } })
    fireEvent.submit(screen.getByRole('textbox', { name: 'Search' }).closest('form')!)
    expect(push).toHaveBeenCalledWith('/admin/things?search=bra')
    fireEvent.click(screen.getByRole('columnheader', { name: 'Name' }))
    expect(push).toHaveBeenLastCalledWith('/admin/things?sort=name&dir=asc', { scroll: false })
  })

  it('DataToolbar writes filters, shows Clear when active and clears them', () => {
    search = 'status=paid&search=x&page=2'
    render(<DataToolbar search={{ placeholder: 'Search' }} filters={[{ name: 'status', label: 'Status', options: [{ value: 'paid', label: 'Paid' }] }]}><span>extra</span></DataToolbar>)
    expect(screen.getByText('extra')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('paid')
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: '' } })
    expect(push).toHaveBeenLastCalledWith('/admin/things?search=x')
    fireEvent.click(screen.getByRole('button', { name: /Clear/ }))
    expect(push).toHaveBeenLastCalledWith('/admin/things')
  })
})
