import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => '/admin/inflation', useSearchParams: () => new URLSearchParams() }))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }), useToastOptional: () => ({ showToast }) }))
const confirm = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => confirm }))
vi.mock('@admin/app/(admin)/admin/inflation/_components/InflationOverview', () => ({ default: () => <div>inflation-overview</div> }))
vi.mock('@admin/app/(admin)/admin/inflation/_components/InflationHistoryMobileList', () => ({ default: () => null }))
let tab = 'list'
vi.mock('@admin/app/(admin)/admin/products/_components/catalog-overview', () => ({
  useListTab: () => tab,
  TabLinks: () => <div>tabs</div>,
}))
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, onChange, options, placeholder }: any) => (
    <select aria-label={placeholder} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">--</option>
      {options.filter((o: any) => o.value !== '').map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}))

import InflationClient from '@admin/app/(admin)/admin/inflation/InflationClient'

const categories = [
  { id: 'c1', name: 'Power Tools', parent_category_id: null },
  { id: 'c2', name: 'Drills', parent_category_id: 'c1' },
]
const brands = [{ id: 'b1', name: 'Bosch' }, { id: 'b2', name: 'Makita' }]
const products = [
  { id: 'p1', name: 'Hammer Drill', brand_id: 'b1', brand_name: 'Bosch' },
  { id: 'p2', name: 'Impact Driver', brand_id: 'b2', brand_name: 'Makita' },
]
const snap = (n: number) => ({ mrp_ex_gst: n, mrp: n * 1.18, price_ex_gst: n * 0.9, base_price: n * 1.06 })
const previewRows = [
  { id: 'p1', name: 'Hammer Drill', has_variants: false, current: snap(100), projected: snap(110), variants: [] },
  { id: 'p2', name: 'Impact Driver', has_variants: true, current: snap(0), projected: snap(0), variants: [{ id: 'v1', variant_name: '18V Kit', current: snap(200), projected: snap(220) }] },
]
const log = (over: Record<string, unknown> = {}) => ({
  id: 'l1', category_name: 'Power Tools', percentage: 10, applied_fields: [], product_count: 2, applied_by: 'admin',
  applied_at: '2026-03-01T10:00:00Z', is_rollback: false, rolled_back_at: null, rolled_back_by: null,
  snapshot: [{ id: 'p1', name: 'Hammer Drill', has_variants: false, before: snap(100), after: snap(110), variants: [] }], ...over,
})
const fetchMock = vi.fn()
const json = (ok: boolean, body: unknown = {}) => ({ ok, json: async () => body })
let logs: any[]

async function pickCategory() {
  fireEvent.change(await screen.findByLabelText('Select a category…'), { target: { value: 'c1' } })
  await screen.findByText('Hammer Drill')
}

describe('InflationClient', () => {
  beforeEach(() => {
    tab = 'list'
    logs = [log({ category_name: 'Fasteners' }), log({ id: 'l2', category_name: 'Hand Tools', percentage: 5, is_rollback: true, snapshot: null }), log({ id: 'l3', category_name: 'Old', rolled_back_at: '2026-03-02T10:00:00Z' })]
    showToast.mockReset()
    confirm.mockReset()
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (url.startsWith('/api/admin/inflation/logs')) return json(true, { logs, total: logs.length })
      if (url.startsWith('/api/admin/inflation/products')) return json(true, { products })
      if (url.startsWith('/api/admin/inflation/rollback')) return json(true, {})
      if (url.startsWith('/api/admin/inflation?')) return json(true, { preview: previewRows })
      if (url === '/api/admin/inflation' && init?.method === 'POST') return json(true, { product_count: 2 })
      return json(true, {})
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('renders the overview tab', () => {
    tab = 'overview'
    render(asAdmin(<InflationClient categories={categories} brands={brands} />))
    expect(screen.getByText('inflation-overview')).toBeInTheDocument()
    expect(screen.queryByText('Apply Inflation')).not.toBeInTheDocument()
  })

  it('lists the inflation history with rollback badge, rolled-back note and signs', async () => {
    render(asAdmin(<InflationClient categories={categories} brands={brands} />, ))
    expect(await screen.findByText('Hand Tools')).toBeInTheDocument()
    expect(String(fetchMock.mock.calls.find(c => String(c[0]).startsWith('/api/admin/inflation/logs'))![0])).toContain('limit=10&offset=0')
    expect(screen.getByText('Rollback', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText('−5%')).toBeInTheDocument()
    expect(screen.getByText(/Rolled back/)).toBeInTheDocument()
  })

  it('shows the empty history state', async () => {
    logs = []
    render(asAdmin(<InflationClient categories={categories} brands={brands} />))
    expect(await screen.findByText('No inflation applied yet.')).toBeInTheDocument()
  })

  it('expands a history row to show its before/after snapshot', async () => {
    render(asAdmin(<InflationClient categories={categories} brands={brands} />))
    fireEvent.click((await screen.findByText('Fasteners')).closest('tr')!)
    expect(await screen.findByText('Product / Variant')).toBeInTheDocument()
    expect(screen.getByText('₹110.00')).toBeInTheDocument()
  })

  it('loads products for a category, all selected, and Deselect All clears them', async () => {
    render(asAdmin(<InflationClient categories={categories} brands={brands} />))
    await pickCategory()
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/inflation/products?category_id=c1')
    expect(screen.getByText('2 of 2 products selected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Deselect All' }))
    expect(screen.getByText('0 of 2 products selected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Select All' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Hammer Drill/ }))
    expect(screen.getByText('1 of 2 products selected')).toBeInTheDocument()
  })

  it('filters the product list by brand and reloads with the brand id', async () => {
    render(asAdmin(<InflationClient categories={categories} brands={brands} />))
    await pickCategory()
    fireEvent.change(screen.getAllByLabelText('All Brands')[0], { target: { value: 'b1' } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/inflation/products?category_id=c1&brand_id=b1'))
  })

  it('keeps Preview disabled until the percentage is valid, then previews with the selected ids', async () => {
    render(asAdmin(<InflationClient categories={categories} brands={brands} />))
    await pickCategory()
    const btn = screen.getByRole('button', { name: 'Preview Changes' })
    expect(btn).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('e.g. 10 for +10%'), { target: { value: '150' } })
    expect(btn).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('e.g. 10 for +10%'), { target: { value: '10' } })
    expect(btn).toBeEnabled()
    fireEvent.click(btn)
    expect(await screen.findByText('Preview — Power Tools')).toBeInTheDocument()
    const url = String(fetchMock.mock.calls.find(c => String(c[0]).startsWith('/api/admin/inflation?'))![0])
    expect(url).toContain('category_id=c1')
    expect(url).toContain('percentage=10')
    expect(url).toContain('product_ids=p1%2Cp2')
    expect(screen.getByText('₹110.00')).toBeInTheDocument()
    expect(screen.getAllByText('see variants').length).toBeGreaterThan(0)
    expect(screen.getByText('18V Kit')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply to 2 products' })).toBeInTheDocument()
  })

  it('toasts the preview error', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/admin/inflation/logs')) return json(true, { logs: [], total: 0 })
      if (url.startsWith('/api/admin/inflation/products')) return json(true, { products })
      return json(false, { error: 'No GST rate set' })
    })
    render(asAdmin(<InflationClient categories={categories} brands={brands} />))
    await pickCategory()
    fireEvent.change(screen.getByPlaceholderText('e.g. 10 for +10%'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview Changes' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('No GST rate set', 'error'))
  })

  it('applies the inflation, resets the form, refreshes history and toasts', async () => {
    render(asAdmin(<InflationClient categories={categories} brands={brands} />))
    await pickCategory()
    fireEvent.change(screen.getByPlaceholderText('e.g. 10 for +10%'), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview Changes' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Apply to 2 products' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('+10% applied to 2 products in "Power Tools".', 'success'))
    const post = fetchMock.mock.calls.find(c => c[0] === '/api/admin/inflation' && c[1]?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toEqual({ category_id: 'c1', category_name: 'Power Tools', percentage: 10, product_ids: ['p1', 'p2'] })
    await waitFor(() => expect(screen.queryByText('Hammer Drill')).not.toBeInTheDocument())
    expect(screen.getByPlaceholderText('e.g. 10 for +10%')).toHaveValue(null)
  })

  it('toasts the apply error', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (url.startsWith('/api/admin/inflation/logs')) return json(true, { logs: [], total: 0 })
      if (url.startsWith('/api/admin/inflation/products')) return json(true, { products })
      if (init?.method === 'POST') return json(false, { error: 'Locked' })
      return json(true, { preview: previewRows })
    })
    render(asAdmin(<InflationClient categories={categories} brands={brands} />))
    await pickCategory()
    fireEvent.change(screen.getByPlaceholderText('e.g. 10 for +10%'), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview Changes' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Apply to 2 products' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Locked', 'error'))
  })

  it('hides Apply without the financial write scope', async () => {
    render(asMember(<InflationClient categories={categories} brands={brands} />, ['financial:read']))
    await pickCategory()
    fireEvent.change(screen.getByPlaceholderText('e.g. 10 for +10%'), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview Changes' }))
    await screen.findByText('Preview — Power Tools')
    expect(screen.queryByRole('button', { name: /^Apply to/ })).not.toBeInTheDocument()
  })

  it('rolls back a run after confirmation and reloads the history', async () => {
    confirm.mockResolvedValue(true)
    render(asAdmin(<InflationClient categories={categories} brands={brands} />))
    await screen.findByText('Hand Tools')
    const callsBefore = fetchMock.mock.calls.filter(c => String(c[0]).startsWith('/api/admin/inflation/logs')).length
    fireEvent.click(screen.getByRole('button', { name: 'Rollback' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(c => c[0] === '/api/admin/inflation/rollback')).toBe(true))
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Rollback Price Change?', variant: 'danger' }))
    expect(JSON.parse(fetchMock.mock.calls.find(c => c[0] === '/api/admin/inflation/rollback')![1].body)).toEqual({ log_id: 'l1' })
    await waitFor(() => expect(fetchMock.mock.calls.filter(c => String(c[0]).startsWith('/api/admin/inflation/logs')).length).toBeGreaterThan(callsBefore))
  })

  it('does not roll back when declined, and surfaces a rollback failure', async () => {
    confirm.mockResolvedValue(false)
    render(asAdmin(<InflationClient categories={categories} brands={brands} />))
    await screen.findByText('Hand Tools')
    fireEvent.click(screen.getByRole('button', { name: 'Rollback' }))
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(fetchMock.mock.calls.some(c => c[0] === '/api/admin/inflation/rollback')).toBe(false)
    confirm.mockResolvedValue(true)
    fetchMock.mockImplementation(async (url: string) =>
      url.startsWith('/api/admin/inflation/rollback') ? json(false, { error: 'Snapshot missing' }) : json(true, { logs, total: logs.length }))
    fireEvent.click(screen.getByRole('button', { name: 'Rollback' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Snapshot missing', 'error'))
  })

  it('hides Rollback without write access', async () => {
    render(asMember(<InflationClient categories={categories} brands={brands} />, ['financial:read']))
    await screen.findByText('Hand Tools')
    expect(within(document.body).queryByRole('button', { name: 'Rollback' })).not.toBeInTheDocument()
  })
})
