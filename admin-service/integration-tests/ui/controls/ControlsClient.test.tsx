import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

const push = vi.fn()
let sp = new URLSearchParams('category_id=c1')
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }), usePathname: () => '/admin/controls', useSearchParams: () => sp }))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }), useToastOptional: () => ({ showToast }) }))
const confirm = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => confirm }))
vi.mock('@admin/app/(admin)/admin/products/_components/ProductsAdvancedFilters', () => ({ default: () => <div>advanced-filters</div> }))
vi.mock('@admin/app/(admin)/admin/controls/_components/ControlsLoadingParts', () => ({
  HistoryRowsSkeleton: () => <div>history-skeleton</div>,
  ProductRowsSkeleton: () => <div>products-skeleton</div>,
}))
vi.mock('@/components/admin/ai/AiMediaButton', () => ({ default: () => null }))
vi.mock('@/components/admin/GalleryPicker', () => ({
  default: ({ onConfirm }: any) => (
    <button onClick={() => onConfirm([{ id: 'g1', thumbnail_url: null, image_url: 'https://cdn.test/g1.jpg', file_name: 'g1.jpg', custom_name: 'Hero shot' }])}>pick-gallery</button>
  ),
}))
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, onChange, options, placeholder }: any) => (
    <select aria-label={placeholder ?? `select-${value}`} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">--</option>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}))

import ControlsClient from '@admin/app/(admin)/admin/controls/ControlsClient'

const product = (over: Record<string, unknown> = {}) => ({
  id: 'p1', name: 'Hammer Drill', sku: 'HD-1', has_variants: false, mrp_ex_gst: '1000', mrp: '1180', price_ex_gst: '900', base_price: '1062',
  discount_pct: '10', gst_percentage: '18', grade: '8.8', condition: 'new', target_gender: null, shipping_class: 'standard', tax_class: 'standard',
  hsn_code: null, handling_days: 0, warranty_months: null, is_featured: false, is_searchable: true, is_active: true,
  brand_name: 'Bosch', category_name: 'Power Tools', variant_mrp_min: null, variant_mrp_max: null, ...over,
})
const products = [product(), product({ id: 'p2', name: 'Bit Set', grade: null, mrp_ex_gst: null, variant_mrp_min: '100', variant_mrp_max: '300', brand_name: null })]
const logs = [
  { id: 'l1', operation: 'inflate_price', product_count: 2, applied_by: 'admin', applied_at: '2026-03-01T10:00:00Z', rolled_back_at: null, is_rollback: false, value: '10', snapshot: { products: [{ id: 'p1', name: 'Hammer Drill', before: { mrp_ex_gst: 900, discount: null } }], variants: [{ id: 'v1', before: {} }] } },
  { id: 'l2', operation: 'set_selling_unit', product_count: 1, applied_by: null, applied_at: '2026-03-02T10:00:00Z', rolled_back_at: '2026-03-03T10:00:00Z', is_rollback: false, value: { unit: 'box', factor: 12 }, snapshot: null },
]
const fetchMock = vi.fn()
const json = (ok: boolean, body: unknown = {}) => ({ ok, json: async () => body })
const draw = (scopes = ['controls:write'], role: 'admin' | 'member' = 'member') =>
  render((role === 'admin' ? asAdmin : asMember)(<ControlsClient categories={[{ id: 'c1', name: 'Power Tools', parent_category_id: null }]} brands={[{ id: 'b1', name: 'Bosch' }]} specFields={[]} />, scopes))

async function chooseOp(key: string) {
  await screen.findByText('Hammer Drill')
  fireEvent.change(screen.getByLabelText('Choose operation…'), { target: { value: key } })
}

describe('ControlsClient', () => {
  beforeEach(() => {
    sp = new URLSearchParams('category_id=c1')
    for (const m of [push, showToast, confirm]) m.mockReset()
    confirm.mockResolvedValue(true)
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (url.startsWith('/api/admin/controls/rollback?')) return json(true, { logs, hasMore: false })
      if (url.startsWith('/api/admin/controls?')) return json(true, { products })
      if (url === '/api/admin/controls' && init?.method === 'POST') return json(true, { updated: 2, log_id: 'l9' })
      if (url === '/api/admin/controls/rollback') return json(true, { restored: 2 })
      return json(true, {})
    })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.useRealTimers())

  it('prompts for filters when none are set', async () => {
    sp = new URLSearchParams()
    draw()
    expect(screen.getByText('Add one or more filters above to load products.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(c => String(c[0]).startsWith('/api/admin/controls?'))).toBe(false)
  })

  it('loads products for the active filters with prices, all selected', async () => {
    draw()
    expect(await screen.findByText('Hammer Drill')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/controls?category_id=c1')
    expect(screen.getByText('2 of 2 selected')).toBeInTheDocument()
    expect(screen.getByText('₹1000.00 ex-GST · 10% off')).toBeInTheDocument()
    expect(screen.getByText('₹100.00–₹300.00 ex-GST (variants)')).toBeInTheDocument()
    expect(screen.getByText('Grade: 8.8')).toBeInTheDocument()
  })

  it('shows the load error and the no-match empty state', async () => {
    fetchMock.mockImplementation(async (url: string) => (url.startsWith('/api/admin/controls?') ? json(false, { error: 'Query failed' }) : json(true, { logs: [] })))
    draw()
    expect(await screen.findByText('Query failed')).toBeInTheDocument()
    expect(screen.getByText('No active products match the current filters.')).toBeInTheDocument()
  })

  it('Clear all navigates back to the bare path', async () => {
    draw()
    await screen.findByText('Hammer Drill')
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(push).toHaveBeenCalledWith('/admin/controls')
  })

  it('deselect all disables Apply, selecting a single product re-enables it', async () => {
    draw()
    await chooseOp('set_discount')
    fireEvent.change(screen.getByPlaceholderText('0–100'), { target: { value: '15' } })
    expect(screen.getByRole('button', { name: 'Apply to 2 products' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Deselect All' }))
    expect(screen.getByRole('button', { name: 'Apply to 0 products' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: /Hammer Drill/ }))
    expect(screen.getByRole('button', { name: 'Apply to 1 product' })).toBeEnabled()
  })

  it('applies a numeric operation after confirmation and offers Undo', async () => {
    draw()
    await chooseOp('inflate_price')
    fireEvent.change(screen.getByPlaceholderText('e.g. 10'), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply to 2 products' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Inflate Price applied to 2 products.', 'success'))
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Apply: Inflate Price?', variant: 'default' }))
    const post = fetchMock.mock.calls.find(c => c[0] === '/api/admin/controls' && c[1]?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toEqual({ operation: 'inflate_price', value: '10', product_ids: ['p1', 'p2'], inherit_to_variants: true })
    expect(await screen.findByText('Last change: Inflate Price')).toBeInTheDocument()
  })

  it('uses a danger confirm for destructive operations and skips the request when declined', async () => {
    confirm.mockResolvedValue(false)
    draw()
    await chooseOp('set_active')
    fireEvent.change(screen.getByLabelText('Select…'), { target: { value: 'false' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply to 2 products' }))
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' })))
    expect(fetchMock.mock.calls.some(c => c[1]?.method === 'POST')).toBe(false)
  })

  it('toasts the server error when applying fails', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (init?.method === 'POST') return json(false, { error: 'Not permitted' })
      if (url.includes('rollback?')) return json(true, { logs: [] })
      return json(true, { products })
    })
    draw()
    await chooseOp('set_hsn_code')
    fireEvent.change(screen.getByPlaceholderText('e.g. 73181500'), { target: { value: '7318' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply to 2 products' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Not permitted', 'error'))
  })

  it('Undo of the last change confirms, posts the log id and reports the restored count', async () => {
    draw()
    await chooseOp('inflate_price')
    fireEvent.change(screen.getByPlaceholderText('e.g. 10'), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply to 2 products' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Rolled back "Inflate Price" — 2 products restored.', 'success'))
    const post = fetchMock.mock.calls.find(c => c[0] === '/api/admin/controls/rollback' && c[1]?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toEqual({ log_id: 'l9' })
  })

  it('posts a selling-unit value with the factor and quantity limits', async () => {
    draw()
    await chooseOp('set_selling_unit')
    fireEvent.change(screen.getByLabelText('— pick —'), { target: { value: 'dozen' } })
    expect(screen.getAllByText('(fixed)').length).toBe(2)
    fireEvent.change(screen.getByPlaceholderText('e.g. Box of 100'), { target: { value: 'Carton of 24' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. 50'), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply to 2 products' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(c => c[0] === '/api/admin/controls' && c[1]?.method === 'POST')).toBe(true))
    const body = JSON.parse(fetchMock.mock.calls.find(c => c[0] === '/api/admin/controls' && c[1]?.method === 'POST')![1].body)
    expect(body.value).toEqual({ unit: 'dozen', factor: 12, dimension: 'count', display_label: 'Carton of 24', min_qty: 1, max_qty: 10, qty_step: 1 })
  })

  it('replacing images: validates the file type, then uploads multipart and polls the job to completion', async () => {
    draw()
    await chooseOp('set_images')
    const input = document.getElementById('bulk-image-input') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'doc.pdf', { type: 'application/pdf' })] } })
    expect(screen.getByText('"doc.pdf" — only JPEG, PNG, WebP allowed.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply to 2 products' })).toBeDisabled()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x' }))
    fireEvent.change(input, { target: { files: [new File(['x'], 'new.png', { type: 'image/png' })] } })
    expect(screen.getByText('new.png')).toBeInTheDocument()
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (url === '/api/admin/controls' && init?.method === 'POST') return json(true, { job_id: 'j1', total: 2, skipped: 0 })
      if (url === '/api/admin/controls/jobs/j1') return json(true, { job: { id: 'j1', status: 'completed', done: 2, skipped: 1, log_id: 'l7' } })
      if (url.includes('rollback?')) return json(true, { logs: [] })
      return json(true, { products })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply to 2 products' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Replacing images…' })).toBeDisabled())
    const post = fetchMock.mock.calls.find(c => c[0] === '/api/admin/controls' && c[1]?.method === 'POST')!
    expect(post[1].body).toBeInstanceOf(FormData)
    expect(post[1].body.get('operation')).toBe('set_images')
    expect(post[1].body.get('slot')).toBe('1')
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Replace Images applied to 2 products (1 skipped — no image in that slot).', 'success'), { timeout: 4000 })
  })

  it('picks a gallery image for the replacement', async () => {
    draw()
    await chooseOp('set_images')
    fireEvent.click(screen.getByRole('button', { name: 'Gallery' }))
    fireEvent.click(screen.getByText('Choose from gallery'))
    fireEvent.click(screen.getByText('pick-gallery'))
    expect(await screen.findByText('Hero shot')).toBeInTheDocument()
    expect(screen.getByText('From gallery')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply to 2 products' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(screen.getByRole('button', { name: 'Apply to 2 products' })).toBeDisabled()
  })

  it('lists the operation history with value summaries and expands a row to its snapshot', async () => {
    draw()
    expect(await screen.findByText('— 10')).toBeInTheDocument()
    expect(screen.getByText('— box (×12)')).toBeInTheDocument()
    expect(screen.getByText(/\(\+ 1 variant\)/)).toBeInTheDocument()
    expect(screen.getByText(/Rolled back/)).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { expanded: false })[0])
    expect(screen.getByText('mrp_ex_gst:')).toBeInTheDocument()
    expect(screen.getByText('Rollback also restores 1 variant.')).toBeInTheDocument()
  })

  it('rolls back a logged operation from history', async () => {
    draw()
    fireEvent.click(await screen.findByRole('button', { name: 'Rollback' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Rolled back "Inflate Price" — 2 products restored.', 'success'))
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Undo operation?' }))
  })

  it('hides Apply and Rollback without write access, and shows an empty history', async () => {
    fetchMock.mockImplementation(async (url: string) => (url.includes('rollback?') ? json(true, { logs: [] }) : json(true, { products })))
    draw(['controls:read'])
    await screen.findByText('Hammer Drill')
    expect(screen.getByRole('button', { name: 'Apply to 2 products', hidden: true })).toHaveClass('hidden')
    expect(await screen.findByText('No operations recorded yet.')).toBeInTheDocument()
  })

  it('shows the history load error', async () => {
    fetchMock.mockImplementation(async (url: string) => (url.includes('rollback?') ? json(false, { error: 'History down' }) : json(true, { products })))
    draw()
    expect(await screen.findByText('History down')).toBeInTheDocument()
  })
})
