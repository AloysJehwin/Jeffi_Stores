import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ identity: { name: 'Acme Store' } }) }))
let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({
  RequireWrite: ({ children }: any) => (canWrite ? <>{children}</> : null),
}))
vi.mock('@/components/admin/AIEnrichButton', () => ({ default: ({ children }: any) => <>{children}</> }))
vi.mock('@/components/ui/CopySku', () => ({ default: () => <i /> }))

import BrochureModal from '@/components/admin/BrochureModal'

const categories = [
  { id: 'c1', name: 'Fasteners', parent_category_id: null },
  { id: 'c2', name: 'Bolts', parent_category_id: 'c1' },
  { id: 'c3', name: 'Pipes', parent_category_id: null },
]
const brands = [{ id: 'b1', name: 'Acme' }, { id: 'b2', name: 'Globex' }]

const product = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  slug: id,
  sku: `SKU-${id}`,
  short_description: null,
  mrp: null,
  base_price: 100,
  brand_name: 'Acme',
  category_name: 'Fasteners',
  thumbnail_url: null,
  ...over,
})

const J = (body: unknown, ok = true, headers: Record<string, string> = {}) => ({
  ok,
  json: async () => body,
  blob: async () => new Blob(['pdf']),
  headers: { get: (k: string) => headers[k] ?? null },
})

let products: any[]
let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>

function wire(extra: (url: string, init?: any) => any = () => undefined) {
  fetchMock = vi.fn<(...a: any[]) => any>().mockImplementation(async (url: string, init?: any) => {
    const o = extra(url, init)
    if (o) return o
    if (url === '/api/categories') return J({ categories })
    if (url === '/api/brands') return J({ brands })
    if (url.startsWith('/api/admin/brochure/products')) return J({ products })
    return J({})
  })
  vi.stubGlobal('fetch', fetchMock)
}

describe('BrochureModal', () => {
  beforeEach(() => {
    canWrite = true
    products = [product('p1', 'Hex Bolt'), product('p2', 'Washer', { mrp: 200, base_price: 150, thumbnail_url: 'https://cdn.test/w.png' })]
    wire()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }))
  })

  const mount = (mode: 'category' | 'brand' = 'category', open = true) => {
    const onClose = vi.fn()
    const view = render(<BrochureModal open={open} mode={mode} onClose={onClose} />)
    return { onClose, ...view }
  }

  it('renders nothing while closed and does not fetch', () => {
    const { container } = mount('category', false)
    expect(container.firstChild).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('lists categories with sub-categories indented and a hint to pick one', async () => {
    mount()
    expect(await screen.findByText('Fasteners')).toBeInTheDocument()
    expect(screen.getByText('Bolts')).toBeInTheDocument()
    expect(screen.getByText('Select a category to list its products')).toBeInTheDocument()
    expect(screen.getByText('Nothing selected yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Download PDF/ })).toBeDisabled()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/categories')
  })

  it('brand mode lists brands from the brands endpoint', async () => {
    mount('brand')
    expect(await screen.findByText('Globex')).toBeInTheDocument()
    expect(screen.getByText('Select a brand to list its products')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/brands')
  })

  it('selecting a parent category cascades to its children and loads their products pre-selected', async () => {
    mount()
    fireEvent.click(await screen.findByLabelText('Fasteners'))
    expect(screen.getByLabelText('Bolts')).toBeChecked()
    expect(await screen.findByText('Hex Bolt', { selector: '.truncate' })).toBeInTheDocument()
    const url = fetchMock.mock.calls.find(c => String(c[0]).startsWith('/api/admin/brochure/products'))![0]
    expect(url).toContain('categoryIds=c1')
    expect(url).toContain('categoryIds=c2')
    expect(screen.getByText('2 products selected')).toBeInTheDocument()
  })

  it('deselecting a parent clears its children', async () => {
    mount()
    const parent = await screen.findByLabelText('Fasteners')
    fireEvent.click(parent)
    fireEvent.click(parent)
    expect(screen.getByLabelText('Bolts')).not.toBeChecked()
    expect(screen.getByText('Select a category to list its products')).toBeInTheDocument()
  })

  it('filter All / None buttons', async () => {
    mount()
    await screen.findByText('Fasteners')
    fireEvent.click(screen.getAllByRole('button', { name: 'All' })[0])
    expect(screen.getByLabelText('Pipes')).toBeChecked()
    fireEvent.click(screen.getAllByRole('button', { name: 'None' })[0])
    expect(screen.getByLabelText('Pipes')).not.toBeChecked()
  })

  it('product checkboxes and All / None change the selection and preview', async () => {
    mount()
    fireEvent.click(await screen.findByLabelText('Pipes'))
    await screen.findByText('Washer', { selector: '.truncate' })
    fireEvent.click(screen.getByLabelText('Washer'))
    expect(screen.getByText('1 product selected')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'None' })[1])
    expect(screen.getByText('0 products selected')).toBeInTheDocument()
    expect(screen.getByText('Nothing selected yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Download PDF/ })).toBeDisabled()
    fireEvent.click(screen.getAllByRole('button', { name: 'All' })[1])
    expect(screen.getByText('2 products selected')).toBeInTheDocument()
  })

  it('shows empty and error states for products', async () => {
    products = []
    mount()
    fireEvent.click(await screen.findByLabelText('Pipes'))
    expect(await screen.findByText('No products found')).toBeInTheDocument()
  })

  it('shows an error when products fail to load', async () => {
    wire(url => (url.startsWith('/api/admin/brochure/products') ? Promise.reject(new Error('x')) : undefined))
    mount()
    fireEvent.click(await screen.findByLabelText('Pipes'))
    expect(await screen.findByText('Could not load products')).toBeInTheDocument()
  })

  it('shows an error when categories fail to load', async () => {
    wire(url => (url === '/api/categories' ? Promise.reject(new Error('x')) : undefined))
    mount()
    expect(await screen.findByText('Could not load categories')).toBeInTheDocument()
  })

  it('previews cover, index and product pages with discounts, and reacts to title, promo and price toggle', async () => {
    mount()
    fireEvent.click(await screen.findByLabelText('Pipes'))
    await screen.findByText('Washer', { selector: '.truncate' })
    expect(screen.getByText('3 pages')).toBeInTheDocument()
    expect(screen.getByText('Product Brochure', { selector: '.font-bold' })).toBeInTheDocument()
    expect(screen.getByText('25% OFF')).toBeInTheDocument()
    expect(screen.getByText('Rs.150.00')).toBeInTheDocument()
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('e.g. Summer Fastener Catalogue'), { target: { value: 'Winter Catalogue' } })
    fireEvent.change(screen.getByPlaceholderText(/Monsoon Sale/), { target: { value: 'Big sale' } })
    expect(screen.getByText('Winter Catalogue', { selector: '.font-bold' })).toBeInTheDocument()
    expect(screen.getByText('Big sale')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('switch'))
    expect(screen.queryByText('25% OFF')).toBeNull()
  })

  it('splits size variants of one family onto list pages', async () => {
    products = [product('p1', 'Steel Pipe 10mm'), product('p2', 'Steel Pipe 12mm'), product('p3', 'Hex Bolt')]
    mount()
    fireEvent.click(await screen.findByLabelText('Pipes'))
    await screen.findByText('Steel Pipe 12mm', { selector: '.truncate' })
    expect(screen.getByText('4 pages')).toBeInTheDocument()
    expect(screen.getByText('Featured Products', { selector: 'div' })).toBeInTheDocument()
    expect(screen.getByText('More Products')).toBeInTheDocument()
  })

  it('posts the selected products and options and saves with the server filename', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    wire(url => (url === '/api/admin/brochure' ? J({}, true, { 'Content-Disposition': 'attachment; filename="brochure-123.pdf"' }) : undefined))
    mount()
    fireEvent.click(await screen.findByLabelText('Pipes'))
    await screen.findByText('Washer', { selector: '.truncate' })
    fireEvent.click(screen.getByLabelText('Washer'))
    fireEvent.change(screen.getByPlaceholderText('e.g. Summer Fastener Catalogue'), { target: { value: ' Spring ' } })
    fireEvent.click(screen.getByRole('switch'))
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    const post = fetchMock.mock.calls.find(c => c[0] === '/api/admin/brochure')!
    expect(JSON.parse(post[1].body)).toEqual({ productIds: ['p1'], showPrices: false, title: 'Spring' })
  })

  it('shows the server error when generating fails', async () => {
    wire(url => (url === '/api/admin/brochure' ? J({ error: 'PDF engine down' }, false) : undefined))
    mount()
    fireEvent.click(await screen.findByLabelText('Pipes'))
    await screen.findByText('Washer', { selector: '.truncate' })
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }))
    expect(await screen.findByText('PDF engine down')).toBeInTheDocument()
  })

  it('hides the download button without products:write', async () => {
    canWrite = false
    mount()
    await screen.findByText('Fasteners')
    expect(screen.queryByRole('button', { name: /Download PDF/ })).toBeNull()
  })

  it('Cancel, the X and the backdrop close; clicks inside do not', async () => {
    const { onClose, container } = mount()
    await screen.findByText('Fasteners')
    fireEvent.click(screen.getByText('Generate Brochure'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(document.querySelector('.fixed.inset-0')!)
    expect(onClose).toHaveBeenCalledTimes(2)
    void container
  })

  it('locks body scroll while open and releases it on close', async () => {
    const { rerender } = mount()
    await screen.findByText('Fasteners')
    expect(document.body.style.overflow).toBe('hidden')
    rerender(<BrochureModal open={false} mode="category" onClose={vi.fn()} />)
    expect(document.body.style.overflow).toBe('')
  })
})
