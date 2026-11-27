import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

let search = 'status=paid'
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(search) }))
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
vi.mock('@/components/admin/kit/toast', () => ({ useActionToast: () => toast }))
vi.mock('@/components/ui/DatePicker', () => ({
  default: ({ value, onChange, 'aria-label': label }: any) => <input aria-label={label} value={value} onChange={e => onChange(e.target.value)} />,
}))

import { ExportButton } from '@/components/admin/export/ExportButton'
import { ExportDialog } from '@/components/admin/export/ExportDialog'
import { publishExportRows } from '@/components/admin/export/export-rows'
import { DEFAULT_BRANDING, type ExportSchema } from '@/lib/export/types'

const schema: ExportSchema = {
  key: 'orders',
  title: 'Orders',
  noun: 'Orders',
  columns: [
    { key: 'order_number', label: 'Order no', id: true },
    { key: 'date', label: 'Date', type: 'datetime', id: true },
    { key: 'total', label: 'Order total', type: 'money', total: 'sum' },
    { key: 'email', label: 'Email', optional: true },
  ],
  filters: [{ key: 'source', label: 'Channels', kind: 'multi', options: [{ value: 'online', label: 'Online' }, { value: 'cash_sale', label: 'Cash sale' }] }],
  scopes: ['filtered', 'page', 'selected', 'all'],
  formats: ['csv', 'xlsx', 'pdf', 'pptx'],
  caps: { csv: 50000, xlsx: 50000, pdf: 5000, pptx: 500 },
  dateRange: { label: 'Date range' },
  defaults: { format: 'xlsx', scope: 'filtered', columns: ['order_number', 'date', 'total'], filters: { source: ['online', 'cash_sale'] }, branding: { ...DEFAULT_BRANDING } },
  presets: [],
  last: null,
}

const fetchMock = vi.fn()
const bodies = () => fetchMock.mock.calls.filter(c => c[1]?.method === 'POST').map(c => JSON.parse(c[1].body))

beforeEach(() => {
  search = 'status=paid'
  publishExportRows('orders', null)
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (!init?.method) return new Response(JSON.stringify(schema), { status: 200 })
    const body = JSON.parse(String(init.body))
    if (body.action === 'count') return new Response(JSON.stringify({ count: 42 }), { status: 200 })
    if (init.method === 'PUT') return new Response(JSON.stringify({ preset: { id: 'p1', name: body.name, options: body.options, updatedAt: '' } }), { status: 200 })
    return new Response('a,b', { status: 200, headers: { 'Content-Disposition': 'attachment; filename="orders-2026-11-27.xlsx"' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() })
})

describe('ExportButton', () => {
  it('opens the dialog with the page query and exports with the defaults in one click', async () => {
    render(<ExportButton exportKey="orders" />)
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect(await screen.findByText('Export Orders')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/export/orders?q=status%3Dpaid')
    const go = await screen.findByRole('button', { name: /Export 42 orders · Excel/ })
    fireEvent.click(go)
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Exported Orders (Excel)'))
    const run = bodies().find(b => b.action === 'export')
    expect(run.options).toMatchObject({ format: 'xlsx', scope: 'filtered', columns: ['order_number', 'date', 'total'] })
    expect(run.context.query).toBe('status=paid')
  })
})

describe('ExportDialog', () => {
  it('switches format, unticks a channel and offers the selection', async () => {
    act(() => publishExportRows('orders', { page: ['a', 'b', 'c'], selected: ['b'] }))
    render(<ExportDialog open onClose={() => {}} exportKey="orders" query="" range={{ from: '2026-11-01', to: '2026-11-27' }} />)
    await screen.findByText('Export Orders')
    expect((screen.getByRole('radio', { name: /Selected rows/ }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /PDF/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Cash sale' }))
    fireEvent.click(screen.getByRole('radio', { name: /Matching current filters/ }))
    await waitFor(() => expect(bodies().some(b => b.action === 'count' && b.options.filters.source.join() === 'online')).toBe(true))
    fireEvent.click(await screen.findByRole('button', { name: /Export 42 orders · PDF/ }))
    await waitFor(() => expect(bodies().some(b => b.action === 'export')).toBe(true))
    const run = bodies().find(b => b.action === 'export')
    expect(run.options).toMatchObject({ format: 'pdf', filters: { source: ['online'] }, range: { from: '2026-11-01', to: '2026-11-27' } })
    expect(run.context.selectedIds).toEqual(['b'])
  })

  it('reorders columns and saves a named preset', async () => {
    render(<ExportDialog open onClose={() => {}} exportKey="orders" />)
    await screen.findByText('Export Orders')
    fireEvent.click(screen.getByRole('button', { name: /Columns/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Move Date up' }))
    fireEvent.click(screen.getByLabelText('Email'))
    fireEvent.click(screen.getByRole('button', { name: /Save as/ }))
    fireEvent.change(screen.getByLabelText('Preset name'), { target: { value: 'Mine' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Saved preset “Mine”'))
    const put = fetchMock.mock.calls.find(c => c[1]?.method === 'PUT')!
    expect(JSON.parse(put[1].body).options.columns).toEqual(['date', 'order_number', 'total', 'email'])
  })

  it('shows a load error', async () => {
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ error: 'Insufficient permissions' }), { status: 403 }))
    render(<ExportDialog open onClose={() => {}} exportKey="orders" />)
    expect(await screen.findByText('Insufficient permissions')).toBeInTheDocument()
  })
})
