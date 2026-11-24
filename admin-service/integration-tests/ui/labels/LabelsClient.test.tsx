import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { asAdmin } from '../_support'

const push = vi.fn()
let sp = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/admin/labels',
  useSearchParams: () => sp,
}))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }), useToastOptional: () => ({ showToast }) }))
vi.mock('@/components/ui/CopySku', () => ({ default: () => null }))
vi.mock('@/components/admin/BatchSerialLabels', () => ({ default: ({ mode }: any) => <div>batch-serial:{mode}</div> }))
vi.mock('@/components/admin/label-preview', async orig => ({
  ...(await orig<any>()),
  LabelPreview: ({ product, showPrice, size }: any) => <div>preview:{product?.name ?? 'none'}:{String(showPrice)}:{size.size}</div>,
}))
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, options, onChange, placeholder }: any) => (
    <select aria-label={placeholder} value={value} onChange={e => onChange(e.target.value)}>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}))

import LabelsClient from '@admin/app/(admin)/admin/labels/LabelsClient'

const labelSizes: any[] = [
  { size: '40x60', label: '40 × 60 mm', widthMm: 60, heightMm: 40, widthPt: 170, heightPt: 113 },
  { size: '50x25', label: '50 × 25 mm', widthMm: 50, heightMm: 25, widthPt: 142, heightPt: 71 },
  { size: 'shelf-card', label: 'Shelf card', widthMm: 100, heightMm: 50, widthPt: 283, heightPt: 142 },
]
const categories = [
  { id: 'c1', name: 'Tools', parent_category_id: null },
  { id: 'c2', name: 'Drills', parent_category_id: 'c1' },
  { id: 'c3', name: 'Paint', parent_category_id: null },
]
const products = [
  { id: 'p1', name: 'Power Drill', variant_name: '18V', sku: 'DR-18', slug: 'drill', mrp: 1500, price_ex_gst: 1000, base_price: 1000, gst_percentage: 18, brand_name: 'Bosch', gtin: null },
  { id: 'p2', name: 'Hammer', variant_name: null, sku: 'HM-1', slug: 'hammer', mrp: null, price_ex_gst: null, base_price: 300, gst_percentage: 18, brand_name: null, gtin: null },
]
const json = (ok: boolean, body: unknown = {}, status = ok ? 200 : 500) => ({ ok, status, json: async () => body, blob: async () => new Blob(['pdf']) })
const fetchMock = vi.fn()
let typeahead: any[] = []

describe('LabelsClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sp = new URLSearchParams()
    typeahead = []
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/admin/labels/products')) return json(true, { products })
      if (url.startsWith('/api/admin/suggest')) return json(true, { items: typeahead })
      return json(true)
    })
    vi.stubGlobal('fetch', fetchMock)
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
  })

  it('lists products to pick, excludes the shelf-card size and shows an empty preview', async () => {
    render(asAdmin(<LabelsClient labelSizes={labelSizes} categories={categories} />))
    expect(await screen.findByText('Power Drill')).toBeInTheDocument()
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/admin/labels/products?q=&limit=40')
    expect(screen.getByRole('button', { name: /40 × 60 mm/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Shelf card/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select products to download' })).toBeDisabled()
    expect(screen.getByText('preview:Power Drill:false:40x60')).toBeInTheDocument()
  })

  it('selecting products builds a basket, a label total, and a carousel preview', async () => {
    render(asAdmin(<LabelsClient labelSizes={labelSizes} categories={categories} />))
    await screen.findByText('Power Drill')
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.click(screen.getAllByRole('checkbox')[1])
    expect(screen.getByText('Selected — 2 items')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download PDF — 2 labels' })).toBeEnabled()
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next →' }))
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
    expect(screen.getByText('preview:Hammer:false:40x60')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(screen.queryByText(/Selected —/)).not.toBeInTheDocument()
  })

  it('per-item quantity is clamped to 1..100 and multiplies with the global copies', async () => {
    render(asAdmin(<LabelsClient labelSizes={labelSizes} categories={categories} />))
    await screen.findByText('Power Drill')
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.click(screen.getByRole('button', { name: '−' }))
    expect(screen.getByRole('button', { name: 'Download PDF — 1 label' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '+' }))
    fireEvent.click(screen.getByRole('button', { name: '+' }))
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '4' } })
    expect(screen.getByRole('button', { name: 'Download PDF — 12 labels' })).toBeInTheDocument()
  })

  it('downloads the PDF with the chosen size, mode, price and QR options', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(asAdmin(<LabelsClient labelSizes={labelSizes} categories={categories} />))
    await screen.findByText('Power Drill')
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.click(screen.getByRole('button', { name: /50 × 25 mm/ }))
    fireEvent.click(screen.getByRole('button', { name: 'A4 sheet' }))
    fireEvent.click(screen.getByRole('button', { name: /Print Price/ }))
    fireEvent.click(screen.getByRole('button', { name: /QR Action/ }))
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: /Download PDF/ }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls.find(c => c[0] === '/api/admin/labels')!
    expect(url).toBe('/api/admin/labels')
    expect(JSON.parse(init.body)).toEqual({ product_ids: ['p1', 'p1'], size: '50x25', copies: 1, sheet: true, showPrice: true, qrAction: true })
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x')
    click.mockRestore()
  })

  it('toasts the server error when label generation fails', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) =>
      init?.method === 'POST' ? json(false, { error: 'Too many labels' }, 400) : json(true, { products }))
    render(asAdmin(<LabelsClient labelSizes={labelSizes} categories={categories} />))
    await screen.findByText('Power Drill')
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.click(screen.getByRole('button', { name: /Download PDF/ }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Too many labels', 'error'))
  })

  it('filters by category and subcategory in the product search', async () => {
    render(asAdmin(<LabelsClient labelSizes={labelSizes} categories={categories} />))
    await screen.findByText('Power Drill')
    expect(screen.queryByLabelText('All subcategories')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('All categories'), { target: { value: 'c1' } })
    await waitFor(() => expect(fetchMock.mock.calls.some(c => String(c[0]).includes('category_id=c1'))).toBe(true))
    fireEvent.change(screen.getByLabelText('All subcategories'), { target: { value: 'c2' } })
    await waitFor(() => expect(fetchMock.mock.calls.some(c => String(c[0]).includes('category_id=c2'))).toBe(true))
  })

  it('searching re-queries after the debounce, and shows the empty result', async () => {
    render(asAdmin(<LabelsClient labelSizes={labelSizes} categories={categories} />))
    await screen.findByText('Power Drill')
    fetchMock.mockImplementation(async () => json(true, { products: [] }))
    fireEvent.change(screen.getByPlaceholderText(/Search by name/), { target: { value: 'zzz' } })
    expect(await screen.findByText('No products found')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(c => String(c[0]).includes('q=zzz'))).toBe(true)
  })

  it('typeahead suggestions add a product from the encoded id with keyboard or click', async () => {
    typeahead = [{ id: ['p9', 'Chisel', '', 'CH-9', 'chisel', '200', '150', '120', '18', 'Stanley', ''].join('\x1f'), label: 'Chisel', sublabel: 'CH-9' }]
    render(asAdmin(<LabelsClient labelSizes={labelSizes} categories={categories} />))
    await screen.findByText('Power Drill')
    const input = screen.getByPlaceholderText(/Search by name/)
    fireEvent.change(input, { target: { value: 'ch' } })
    const sug = await screen.findByText('Chisel', { selector: 'span span, span.font-medium' }, { timeout: 2000 }).catch(() => null)
    expect(sug ?? (await screen.findByText('CH-9'))).toBeTruthy()
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByText('Selected — 1 item')).toBeInTheDocument()
    expect(input).toHaveValue('')
  })

  it('the Batch and Serial tabs push the tab to the URL', async () => {
    render(asAdmin(<LabelsClient labelSizes={labelSizes} categories={categories} />))
    await screen.findByText('Power Drill')
    fireEvent.click(screen.getByRole('tab', { name: 'Batch product' }))
    expect(push).toHaveBeenCalledWith('/admin/labels?tab=batch', { scroll: false })
    expect(screen.getByText('batch-serial:batch')).toBeInTheDocument()
    expect(screen.queryByText('Select Products & Variants')).not.toBeInTheDocument()
  })

  it('opens on the tab named in the URL', async () => {
    sp = new URLSearchParams('tab=serial')
    render(asAdmin(<LabelsClient labelSizes={labelSizes} categories={categories} />))
    expect(await screen.findByText('batch-serial:serial')).toBeInTheDocument()
  })

  it('shows the placeholder when search fails and no product is selected', async () => {
    fetchMock.mockRejectedValue(new Error('net'))
    render(asAdmin(<LabelsClient labelSizes={labelSizes} categories={categories} />))
    expect(await screen.findByText('No products found')).toBeInTheDocument()
    expect(screen.getByText('Select a product to preview')).toBeInTheDocument()
  })
})
