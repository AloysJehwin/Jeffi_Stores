import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

const push = vi.fn()
let sp = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/admin/inventory',
  useSearchParams: () => sp,
}))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }), useToastOptional: () => ({ showToast }) }))
const confirm = vi.fn()
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => confirm }))
vi.mock('@/components/ui/CopySku', () => ({ default: () => null }))
vi.mock('@/components/ui/HoverCard', () => ({ default: ({ trigger }: any) => <>{trigger}</> }))
vi.mock('@/components/admin/kit/list-filters', async orig => ({ ...(await orig<any>()), ListFilters: ({ entity }: any) => <div>filters:{entity}</div> }))
vi.mock('@admin/app/(admin)/admin/inventory/_components/InventoryOverviewTab', () => ({ default: () => <div>overview-tab</div> }))
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, options, onChange }: any) => (
    <select value={value} onChange={e => onChange(e.target.value)}>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}))

import InventoryClient from '@admin/app/(admin)/admin/inventory/InventoryClient'

const tx = (over: Record<string, unknown> = {}) => ({
  id: 't1', created_at: '2026-03-01T10:00:00Z', transaction_type: 'sale', quantity_change: -2, quantity_after: 8, reference_type: 'order',
  reference_id: 'o1', notes: null, unit_id: null, unit_label: null, unit_factor: null, quantity_in_unit: null, product_id: 'p1', product_name: 'Power Drill',
  product_sku: 'DR-1', variant_id: null, variant_name: null, sub_variant_id: null, sub_variant_name: null, reference_label: 'INV-7', batch_id: null,
  lot_number: null, expiry_date: null, serial_number: null, ...over,
})
const valRow = (over: Record<string, unknown> = {}) => ({
  id: 'p1', name: 'Power Drill', variant_id: null, sub_variant_id: null, sku: 'DR-1', inventory_quantity: '10', cost_price: '100', selling_price: '118',
  gst_percentage: '18', sell_unit_dimension: 'count', sell_unit: 'pc', perishable: false, serialized: false, ...over,
})
const json = (ok: boolean, body: unknown = {}, status = ok ? 200 : 500) => ({ ok, status, json: async () => body })
const fetchMock = vi.fn()
let ledger: any
let valuation: any
let batches: any[]
const stockCalls = () => fetchMock.mock.calls.filter(c => String(c[0]).startsWith('/api/admin/inventory/stock'))

describe('InventoryClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sp = new URLSearchParams()
    vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
    confirm.mockResolvedValue(true)
    ledger = { transactions: [tx()], total: 1, window: { from: '2026-02-01', days: 30 }, capped: false }
    valuation = { products: [valRow()], total: 1, totalValue: 1000, totalValueInclGst: 1180, inStockCount: 1 }
    batches = [{ batch_id: 'b1', lot_number: 'LOT-9', expiry_date: '2099-01-01', quantity_remaining: '4', unit_cost: '50', location: 'A-1' }]
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (url.startsWith('/api/admin/inventory/stock?')) {
        if (url.includes('view=ledger')) return json(true, ledger)
        if (url.includes('view=valuation')) return json(true, valuation)
        if (url.includes('view=batch_valuation')) return json(true, { batches })
      }
      if (url.startsWith('/api/admin/shelving/warehouses')) return json(true, { warehouses: [] })
      if (url.startsWith('/api/admin/shelving/stock')) return json(true, { locations: [] })
      if (url.includes('/units')) return json(true, { units: [] })
      return json(true, {})
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('opens on the overview tab and tab changes push the tab to the URL', async () => {
    render(asAdmin(<InventoryClient />))
    expect(screen.getByText('overview-tab')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Stock ledger' }))
    expect(push).toHaveBeenCalledWith(expect.stringContaining('tab=ledger'), { scroll: false })
    expect(await screen.findByText('filters:inventory.ledger')).toBeInTheDocument()
    expect(screen.queryByText('overview-tab')).not.toBeInTheDocument()
  })

  it('old filter links land on the tab they belong to', async () => {
    sp = new URLSearchParams('val_search=drill')
    render(asAdmin(<InventoryClient />))
    expect(await screen.findByText('filters:inventory.valuation')).toBeInTheDocument()
  })

  it('the ledger lists a movement with product, signed change, balance and reference link', async () => {
    sp = new URLSearchParams('tab=ledger')
    render(asAdmin(<InventoryClient />))
    expect(await screen.findByRole('link', { name: 'Power Drill' })).toHaveAttribute('href', expect.stringContaining('/admin/products/p1'))
    const url = String(stockCalls()[0][0])
    expect(url).toContain('view=ledger')
    expect(url).toContain('page=1')
    expect(screen.getByRole('link', { name: 'INV-7' })).toHaveAttribute('href', expect.stringContaining('/admin/invoices/o1/view'))
    expect(screen.getAllByText('−2').length).toBeGreaterThan(0)
    expect(screen.getByText('Showing the last 30 days. Pick dates to see older movements.')).toBeInTheDocument()
  })

  it('links cash-sale references and only links GRNs with the financial scope', async () => {
    ledger = {
      transactions: [
        tx({ id: 't2', reference_type: 'cash_sale', reference_id: 'c1', reference_label: 'CS-1' }),
        tx({ id: 't3', reference_type: 'grn', reference_id: 'g1', reference_label: 'GRN-1', transaction_type: 'purchase', quantity_change: 5 }),
      ],
      total: 2, window: null, capped: true,
    }
    sp = new URLSearchParams('tab=ledger')
    const { unmount } = render(asAdmin(<InventoryClient />))
    expect(await screen.findByRole('link', { name: 'CS-1' })).toHaveAttribute('href', expect.stringContaining('/admin/cash-sale/c1/view'))
    expect(screen.getByRole('link', { name: 'GRN-1' })).toHaveAttribute('href', expect.stringContaining('/admin/financial?tab=grn'))
    expect(screen.getByText(/movements match; narrow the filters/)).toBeInTheDocument()
    unmount()
    render(asMember(<InventoryClient />, ['inventory:read']))
    await screen.findByRole('link', { name: 'CS-1' })
    expect(screen.queryByRole('link', { name: 'GRN-1' })).not.toBeInTheDocument()
    expect(screen.getByText(/grn \/ g1/)).toBeInTheDocument()
  })

  it('shows the empty ledger messages', async () => {
    ledger = { transactions: [], total: 0, window: { from: '2026-02-01', days: 30 }, capped: false }
    sp = new URLSearchParams('tab=ledger')
    const { unmount } = render(asAdmin(<InventoryClient />))
    expect(await screen.findByText('No stock movements in the last 30 days')).toBeInTheDocument()
    unmount()
    ledger = { transactions: [], total: 0, window: null, capped: false }
    render(asAdmin(<InventoryClient />))
    expect(await screen.findByText('No stock transactions yet')).toBeInTheDocument()
  })

  it('passes the chosen sort to the server', async () => {
    sp = new URLSearchParams('tab=ledger&sort=change&dir=asc')
    render(asAdmin(<InventoryClient />))
    await screen.findByRole('link', { name: 'Power Drill' })
    expect(String(stockCalls()[0][0])).toContain('sort=change')
    expect(String(stockCalls()[0][0])).toContain('dir=asc')
  })

  it('valuation shows the summary cards and a stock row with values', async () => {
    sp = new URLSearchParams('tab=valuation')
    render(asAdmin(<InventoryClient />))
    expect(await screen.findByRole('link', { name: 'Power Drill' })).toBeInTheDocument()
    expect(String(stockCalls()[0][0])).toContain('view=valuation')
    expect(screen.getAllByText('Stock Value (ex-GST)').length).toBeGreaterThan(0)
    expect(screen.getByText('1 SKUs', { exact: false })).toBeInTheDocument()
    expect(screen.getAllByText(/1,000/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/1,180/).length).toBeGreaterThan(0)
    expect(screen.getByText('18%')).toBeInTheDocument()
  })

  it('valuation empty state', async () => {
    valuation = { products: [], total: 0, totalValue: 0 }
    sp = new URLSearchParams('tab=valuation')
    render(asAdmin(<InventoryClient />))
    expect(await screen.findByText('No products in stock')).toBeInTheDocument()
  })

  it('a product with variants expands to its variant rows', async () => {
    valuation = {
      products: [
        valRow({ id: 'p2', name: 'Paint', variant_id: 'v1', variant_name: 'Red', inventory_quantity: '3', cost_price: '10', selling_price: '12' }),
        valRow({ id: 'p2', name: 'Paint', variant_id: 'v2', variant_name: 'Blue', inventory_quantity: '2', cost_price: '10', selling_price: '12' }),
      ],
      total: 2, totalValue: 50,
    }
    sp = new URLSearchParams('tab=valuation')
    render(asAdmin(<InventoryClient />))
    const head = await screen.findByRole('link', { name: 'Paint' })
    expect(screen.queryByText('Red')).not.toBeInTheDocument()
    fireEvent.click(head.closest('button')!)
    expect((await screen.findAllByText('Red')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Blue').length).toBeGreaterThan(0)
  })

  it('adjusting stock sends the new quantity and note to the inventory API and reloads', async () => {
    sp = new URLSearchParams('tab=valuation')
    render(asAdmin(<InventoryClient />))
    await screen.findByRole('link', { name: 'Power Drill' })
    fireEvent.click(screen.getByRole('button', { name: 'Adjust stock' }))
    const qty = await screen.findByRole('spinbutton')
    expect(qty).toHaveValue(10)
    fireEvent.change(qty, { target: { value: '7' } })
    fireEvent.change(screen.getByPlaceholderText('Note (optional)'), { target: { value: 'recount' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save stock adjustment' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(c => c[1]?.method === 'PATCH')).toBe(true))
    const [url, init] = fetchMock.mock.calls.find(c => c[1]?.method === 'PATCH')!
    expect(url).toBe('/api/admin/inventory/stock')
    expect(JSON.parse(init.body)).toEqual({ product_id: 'p1', variant_id: null, sub_variant_id: null, notes: 'recount', new_quantity: 7 })
    await waitFor(() => expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument())
    await waitFor(() => expect(stockCalls().filter(c => String(c[0]).includes('view=valuation')).length).toBe(2))
  })

  it('Escape cancels an adjustment without saving', async () => {
    sp = new URLSearchParams('tab=valuation')
    render(asAdmin(<InventoryClient />))
    await screen.findByRole('link', { name: 'Power Drill' })
    fireEvent.click(screen.getByRole('button', { name: 'Adjust stock' }))
    fireEvent.keyDown(await screen.findByRole('spinbutton'), { key: 'Escape' })
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some(c => c[1]?.method === 'PATCH')).toBe(false)
  })

  it('batch- or serial-managed stock cannot be adjusted, and read-only admins have no adjust button', async () => {
    valuation = { products: [valRow({ perishable: true })], total: 1, totalValue: 0 }
    sp = new URLSearchParams('tab=valuation')
    const { unmount } = render(asAdmin(<InventoryClient />))
    await screen.findByRole('link', { name: 'Power Drill' })
    expect(screen.getByLabelText('Adjust stock')).toBeDisabled()
    unmount()
    render(asMember(<InventoryClient />, ['inventory:read']))
    await screen.findByRole('link', { name: 'Power Drill' })
    expect(screen.getByLabelText('Adjust stock')).toHaveAttribute('hidden')
  })

  it('expands batch details and removes a batch after confirming', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (url.includes('view=valuation')) return json(true, valuation)
      if (url.includes('view=batch_valuation')) return json(true, { batches })
      if (init?.method === 'DELETE') return json(true, {})
      return json(true, {})
    })
    sp = new URLSearchParams('tab=valuation')
    render(asAdmin(<InventoryClient />))
    await screen.findByRole('link', { name: 'Power Drill' })
    fireEvent.click(screen.getByRole('button', { name: 'Expand batch details' }))
    expect(await screen.findByText('LOT-9')).toBeInTheDocument()
    expect(screen.getByText('Default stock')).toBeInTheDocument()
    expect(String(fetchMock.mock.calls.find(c => String(c[0]).includes('batch_valuation'))![0])).toContain('product_id=p1')
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Batch removed', 'success'))
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Remove Batch', variant: 'danger', message: expect.stringContaining('4 units') }))
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/inventory/batches/b1', { method: 'DELETE' })
  })

  it('shows the no-batches note and toasts a failed batch removal', async () => {
    batches = []
    sp = new URLSearchParams('tab=valuation')
    const { unmount } = render(asAdmin(<InventoryClient />))
    await screen.findByRole('link', { name: 'Power Drill' })
    fireEvent.click(screen.getByRole('button', { name: 'Expand batch details' }))
    expect(await screen.findByText('No batches with remaining stock for this product.')).toBeInTheDocument()
    unmount()
    batches = [{ batch_id: 'b1', lot_number: 'LOT-9', quantity_remaining: '0', unit_cost: '1' }]
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (url.includes('view=valuation')) return json(true, valuation)
      if (url.includes('view=batch_valuation')) return json(true, { batches })
      if (init?.method === 'DELETE') return json(false, { error: 'In use' }, 400)
      return json(true, {})
    })
    render(asAdmin(<InventoryClient />))
    await screen.findByRole('link', { name: 'Power Drill' })
    fireEvent.click(screen.getByRole('button', { name: 'Expand batch details' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('In use', 'error'))
  })
})
