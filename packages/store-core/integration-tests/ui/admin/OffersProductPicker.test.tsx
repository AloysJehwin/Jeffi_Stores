import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

let canWriteScope = true
const showToast = vi.fn<(...a: any[]) => any>()
const showConfirm = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast, showConfirm }) }))
vi.mock('@/contexts/AdminScopesContext', () => ({
  RequireWrite: ({ children }: any) => (canWriteScope ? <>{children}</> : null),
}))
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ label, value, onChange, options, disabled, placeholder }: any) => (
    <select aria-label={label} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}))

import OfferProductPicker from '@/components/admin/OffersProductPicker'

const members = [{ id: 'p1', name: 'Hammer', sku: 'HAM-1' }, { id: 'p2', name: 'Drill', sku: null }]
const cats = [{ value: 'c1', label: 'Tools', name: 'Tools', count: 3 }, { value: 'c2', label: 'Paint', name: 'Paint', count: 1 }]
const brands = [{ value: 'b1', label: 'Acme', name: 'Acme', count: 2 }]
const fetchMock = vi.fn<(...a: any[]) => any>()
const ok = (data: any = {}) => ({ ok: true, json: async () => data })

function setup(props: Record<string, any> = {}) {
  return render(<OfferProductPicker offerId="o1" canWrite categoryOptions={cats as any} brandOptions={brands as any} {...props} />)
}

beforeEach(() => {
  canWriteScope = true
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockImplementation(async (_url: string, init?: any) => (init?.method ? ok({}) : ok({ products: members })))
})
afterEach(() => vi.useRealTimers())

describe('OffersProductPicker', () => {
  it('loads and shows assigned products with count', async () => {
    setup()
    expect(await screen.findByText('Hammer · HAM-1')).toBeInTheDocument()
    expect(screen.getByText('Drill')).toBeInTheDocument()
    expect(screen.getByText('2 assigned')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/product-offers/o1/products')
  })

  it('reads a draft list when draftId is given', async () => {
    setup({ draftId: 'd7' })
    await screen.findByText('Hammer · HAM-1')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/product-offers/o1/products?draft=d7')
  })

  it('toasts when the list cannot be loaded and shows the empty state', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) })
    setup()
    expect(await screen.findByText('No products assigned yet.')).toBeInTheDocument()
    expect(showToast).toHaveBeenCalledWith('Could not load offer products', 'error')
  })

  it('removes a product and saves the remaining ids with PUT', async () => {
    setup()
    await screen.findByText('Hammer · HAM-1')
    fireEvent.click(screen.getAllByTitle('Remove')[0])
    await waitFor(() => expect(fetchMock.mock.calls.some(c => c[1]?.method === 'PUT')).toBe(true))
    const put = fetchMock.mock.calls.find(c => c[1]?.method === 'PUT')!
    expect(JSON.parse(put[1].body)).toEqual({ productIds: ['p2'] })
    expect(screen.queryByText('Hammer · HAM-1')).not.toBeInTheDocument()
  })

  it('reloads and toasts when saving fails', async () => {
    setup()
    await screen.findByText('Hammer · HAM-1')
    fetchMock.mockImplementation(async (_u: string, init?: any) => (init?.method === 'PUT' ? { ok: false, json: async () => ({}) } : ok({ products: members })))
    fireEvent.click(screen.getAllByTitle('Remove')[0])
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Failed to save products', 'error'))
    expect(await screen.findByText('Hammer · HAM-1')).toBeInTheDocument()
  })

  it('searches after a debounce, then adds a result and saves', async () => {
    setup()
    await screen.findByText('Hammer · HAM-1')
    vi.useFakeTimers({ shouldAdvanceTime: true })
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (init?.method) return ok({})
      if (String(url).includes('?q=')) return ok({ items: [{ id: 'p3', label: 'Saw', sublabel: 'SAW-1' }, { id: 'p1', label: 'Hammer' }] })
      return ok({ products: members })
    })
    const box = screen.getByPlaceholderText(/Search products by name or SKU/)
    fireEvent.change(box, { target: { value: 'a' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(fetchMock.mock.calls.some(c => String(c[0]).includes('?q='))).toBe(false)
    fireEvent.change(box, { target: { value: 'saw' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    const saw = await screen.findByRole('button', { name: /Saw/ })
    expect(screen.getByText('added')).toBeInTheDocument()
    fireEvent.click(saw)
    vi.useRealTimers()
    expect(await screen.findByText('Saw · SAW-1')).toBeInTheDocument()
    await waitFor(() => expect(fetchMock.mock.calls.some(c => c[1]?.method === 'PUT')).toBe(true))
    const put = fetchMock.mock.calls.find(c => c[1]?.method === 'PUT')!
    expect(JSON.parse(put[1].body).productIds).toEqual(['p1', 'p2', 'p3'])
  })

  it('bulk-adds by category and reports the count', async () => {
    fetchMock.mockImplementation(async (_u: string, init?: any) => (init?.method === 'POST' ? ok({ changed: 3 }) : ok({ products: members })))
    setup()
    await screen.findByText('Hammer · HAM-1')
    const add = screen.getAllByRole('button', { name: /^Add all$/ })[0]
    expect(add).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Assign by category'), { target: { value: 'c1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add 3 products' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Added 3 products from Tools', 'success'))
    const post = fetchMock.mock.calls.find(c => c[1]?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toEqual({ action: 'add', categoryId: 'c1' })
  })

  it('bulk-removes by brand only after confirming and uses the brand key', async () => {
    showConfirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    fetchMock.mockImplementation(async (_u: string, init?: any) => (init?.method === 'POST' ? ok({ changed: 0 }) : ok({ products: members })))
    setup()
    await screen.findByText('Hammer · HAM-1')
    fireEvent.change(screen.getByLabelText('Assign by brand'), { target: { value: 'b1' } })
    const remove = screen.getAllByRole('button', { name: 'Remove from offer' })[1]
    fireEvent.click(remove)
    await waitFor(() => expect(showConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Remove products?', type: 'danger' })))
    expect(fetchMock.mock.calls.some(c => c[1]?.method === 'POST')).toBe(false)
    fireEvent.click(remove)
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('No products from Acme were in this offer', 'success'))
    const post = fetchMock.mock.calls.find(c => c[1]?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toEqual({ action: 'remove', brandId: 'b1' })
  })

  it('toasts a bulk failure from the server', async () => {
    fetchMock.mockImplementation(async (_u: string, init?: any) => (init?.method === 'POST' ? { ok: false, json: async () => ({ error: 'Offer locked' }) } : ok({ products: members })))
    setup()
    await screen.findByText('Hammer · HAM-1')
    fireEvent.change(screen.getByLabelText('Assign by category'), { target: { value: 'c2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 product' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Offer locked', 'error'))
  })

  it('filters a long assigned list', async () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ id: `m${i}`, name: `Item ${i}`, sku: null }))
    fetchMock.mockResolvedValue(ok({ products: many }))
    setup()
    await screen.findByText('Item 0')
    const filter = screen.getByPlaceholderText('Filter 14 assigned products…')
    fireEvent.change(filter, { target: { value: 'item 13' } })
    expect(screen.getByText('Item 13')).toBeInTheDocument()
    expect(screen.queryByText('Item 2')).not.toBeInTheDocument()
    fireEvent.change(filter, { target: { value: 'zzz' } })
    expect(screen.getByText(/No assigned products match/)).toBeInTheDocument()
  })

  it('is read-only without write access: no search, bulk or remove controls', async () => {
    canWriteScope = false
    setup({ canWrite: false })
    await screen.findByText('Hammer · HAM-1')
    expect(screen.queryByPlaceholderText(/Search products/)).not.toBeInTheDocument()
    expect(screen.queryByTitle('Remove')).not.toBeInTheDocument()
  })
})
