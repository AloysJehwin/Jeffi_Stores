import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import {
  Section, Empty, Kpi, KpiGrid, Badge, Banner, Tabs, TabLinks, TabAction, TabActionsHost, TabActionsPortal,
  Table, when, api, lastDays, RangePresets, money, count, pct, change, type Col,
} from '@/components/admin/kit/core'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

afterEach(() => vi.unstubAllGlobals())

describe('Section / Empty / Banner / Badge', () => {
  it('renders the title, action and children', () => {
    render(
      <Section title="Orders" action={<button>Export</button>}>
        <p>body</p>
      </Section>
    )
    expect(screen.getByRole('heading', { name: 'Orders' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument()
    expect(screen.getByText('body')).toBeInTheDocument()
  })

  it('Empty defaults its message and accepts a custom one', () => {
    const { rerender } = render(<Empty />)
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument()
    rerender(<Empty msg="No campaigns" />)
    expect(screen.getByText('No campaigns')).toBeInTheDocument()
  })

  it('Banner shows green on ok and red otherwise', () => {
    const { container, rerender } = render(<Banner ok>Saved</Banner>)
    expect(screen.getByText('Saved')).toBeInTheDocument()
    expect(container.firstElementChild).toHaveClass('border-green-500/40')
    rerender(<Banner ok={false}>Failed</Banner>)
    expect(container.firstElementChild).toHaveClass('border-red-500/40')
  })

  it('Badge renders its children', () => {
    render(<Badge tone="green">Live</Badge>)
    expect(screen.getByText('Live')).toBeInTheDocument()
  })
})

describe('Kpi', () => {
  it('shows label, value and a good delta with the default suffix', () => {
    render(<Kpi label="Revenue" value="₹10" delta={0.125} />)
    expect(screen.getByText('Revenue')).toBeInTheDocument()
    expect(screen.getByText('₹10')).toBeInTheDocument()
    const d = screen.getByText(/12\.5%/)
    expect(d).toHaveTextContent('vs previous')
    expect(d).toHaveClass('text-green-600')
  })

  it('inverts the colour when invert is set and drops the suffix when sub is given', () => {
    render(<Kpi label="Refunds" value="3" delta={0.2} invert sub="last 7 days" />)
    const d = screen.getByText(/20\.0%/)
    expect(d).toHaveClass('text-red-500')
    expect(d).not.toHaveTextContent('vs previous')
    expect(screen.getByText('last 7 days')).toBeInTheDocument()
  })

  it('renders a link card when href is set', () => {
    render(<Kpi label="Orders" value="9" href="/admin/orders" delta={-0.1} />)
    expect(screen.getByRole('link')).toHaveAttribute('href', '/admin/orders')
    expect(screen.getByText(/10\.0%/)).toBeInTheDocument()
  })

  it('KpiGrid wraps its cards', () => {
    const { container } = render(
      <KpiGrid fill>
        <Kpi label="A" value="1" />
      </KpiGrid>
    )
    expect(container.querySelector('.kpi-grid.kpi-fill')).not.toBeNull()
  })
})

describe('Tabs / TabLinks / TabAction', () => {
  it('marks the selected tab, shows counts and fires onChange', () => {
    const onChange = vi.fn()
    render(<Tabs tabs={[{ id: 'a', label: 'All', count: 4 }, { id: 'b', label: 'Open' }] as const} value="a" onChange={onChange} actions={<span>act</span>} />)
    expect(screen.getByRole('tab', { name: /All/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('(4)')).toBeInTheDocument()
    expect(screen.getByText('act')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Open' }))
    expect(onChange).toHaveBeenCalledWith('b')
  })

  it('TabLinks render anchors with the href', () => {
    render(<TabLinks tabs={[{ id: 'a', label: 'One', href: '/x?tab=a' }, { id: 'b', label: 'Two', href: '/x?tab=b' }] as const} value="b" />)
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveAttribute('href', '/x?tab=b')
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveAttribute('aria-selected', 'true')
  })

  it('TabAction is a button that can be disabled, or a link with href', () => {
    const onClick = vi.fn()
    const { rerender } = render(<TabAction icon={<i />} label="Add" onClick={onClick} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onClick).toHaveBeenCalledTimes(1)
    rerender(<TabAction icon={<i />} label="Add" onClick={onClick} disabled />)
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
    rerender(<TabAction icon={<i />} label="Add" href="/new" />)
    expect(screen.getByRole('link', { name: 'Add' })).toHaveAttribute('href', '/new')
  })

  it('TabActionsPortal renders inline without a host and on the tab line within one', () => {
    const { unmount } = render(<TabActionsPortal><span>inline</span></TabActionsPortal>)
    expect(screen.getByText('inline')).toBeInTheDocument()
    unmount()
    render(
      <TabActionsHost>
        <Tabs tabs={[{ id: 'a', label: 'A' }] as const} value="a" onChange={() => {}} />
        <TabActionsPortal>
          <span>hosted</span>
        </TabActionsPortal>
      </TabActionsHost>
    )
    expect(screen.getByText('hosted')).toBeInTheDocument()
    expect(screen.getByRole('tablist').parentElement?.parentElement).toContainElement(screen.getByText('hosted'))
  })
})

type Row = { id: string; name: string; qty: number }
const rows: Row[] = [
  { id: '1', name: 'Bravo', qty: 5 },
  { id: '2', name: 'Alpha', qty: 20 },
  { id: '3', name: 'Charlie', qty: 1 },
]
const cols: Col<Row>[] = [
  { key: 'name', label: 'Name', render: r => r.name, sort: r => r.name },
  { key: 'qty', label: 'Qty', render: r => String(r.qty), sort: r => r.qty, num: true },
  { key: 'plain', label: 'Plain', render: () => 'x' },
]
const bodyNames = () => screen.getAllByRole('row').slice(1).map(r => within(r).getAllByRole('cell')[0].textContent)

describe('Table', () => {
  it('shows the empty message with no rows', () => {
    render(<Table rows={[]} cols={cols} rowKey={r => r.id} empty="No stock" />)
    expect(screen.getByText('No stock')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('cycles a text column asc -> desc -> cleared', () => {
    render(<Table rows={rows} cols={cols} rowKey={r => r.id} />)
    expect(bodyNames()).toEqual(['Bravo', 'Alpha', 'Charlie'])
    const th = screen.getByRole('columnheader', { name: 'Name' })
    fireEvent.click(th)
    expect(bodyNames()).toEqual(['Alpha', 'Bravo', 'Charlie'])
    fireEvent.click(th)
    expect(bodyNames()).toEqual(['Charlie', 'Bravo', 'Alpha'])
    fireEvent.click(th)
    expect(bodyNames()).toEqual(['Bravo', 'Alpha', 'Charlie'])
  })

  it('sorts a number column descending first and ignores unsortable headers', () => {
    render(<Table rows={rows} cols={cols} rowKey={r => r.id} />)
    fireEvent.click(screen.getByRole('columnheader', { name: 'Qty' }))
    expect(bodyNames()).toEqual(['Alpha', 'Bravo', 'Charlie'])
    fireEvent.click(screen.getByRole('columnheader', { name: 'Plain' }))
    expect(bodyNames()).toEqual(['Alpha', 'Bravo', 'Charlie'])
  })

  it('pages rows with the arrows', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ id: String(i), name: `N${i}`, qty: i }))
    render(<Table rows={many} cols={cols} rowKey={r => r.id} pageSize={3} noun="items" />)
    expect(bodyNames()).toEqual(['N0', 'N1', 'N2'])
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(bodyNames()).toEqual(['N3', 'N4', 'N5'])
    expect(screen.getByText(/items/)).toBeInTheDocument()
  })
})

describe('helpers', () => {
  it('formats money, counts and percentages with a dash for missing values', () => {
    expect(money(1234)).toContain('1,234')
    expect(money(null)).toBe('-')
    expect(money(12.5, 2)).toContain('12.50')
    expect(count(1234567)).toBe('12,34,567')
    expect(count(undefined)).toBe('-')
    expect(pct(0.256)).toBe('25.6%')
    expect(pct(NaN)).toBe('-')
  })

  it('change returns the relative delta and null for a zero base', () => {
    expect(change(150, 100)).toBe(0.5)
    expect(change(50, -100)).toBe(1.5)
    expect(change(5, 0)).toBeNull()
  })

  it('when formats an ISO date in IST or a dash', () => {
    expect(when(null)).toBe('-')
    expect(when('2026-01-02T00:00:00Z')).toMatch(/2 Jan 2026/)
  })

  it('lastDays spans n days ending today with an offset', () => {
    const r = lastDays(7)
    const days = (new Date(r.to).getTime() - new Date(r.from).getTime()) / 86400000
    expect(days).toBe(6)
    const prev = lastDays(7, 7)
    expect(new Date(r.from).getTime() - new Date(prev.to).getTime()).toBe(86400000)
  })

  it('api sends JSON with the fetch header and parses the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 1 }) })
    vi.stubGlobal('fetch', fetchMock)
    const res = await api('/api/x', { method: 'POST', json: { a: 1 } })
    expect(res).toEqual({ ok: true, data: { id: 1 } })
    const init = fetchMock.mock.calls[0][1]
    expect(init.body).toBe('{"a":1}')
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', 'x-requested-with': 'fetch' })
  })

  it('api falls back to an empty object when the body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.reject(new Error('bad')) }))
    expect(await api('/api/x')).toEqual({ ok: false, data: {} })
  })
})

describe('RangePresets', () => {
  it('highlights the active preset and reports a new range on click', () => {
    const onChange = vi.fn()
    render(<RangePresets value={lastDays(30)} onChange={onChange} />)
    expect(screen.getByRole('button', { name: '30d' })).toHaveClass('bg-accent-500')
    expect(screen.getByRole('button', { name: '7d' })).not.toHaveClass('bg-accent-500')
    fireEvent.click(screen.getByRole('button', { name: '7d' }))
    expect(onChange).toHaveBeenCalledWith(lastDays(7))
  })
})
