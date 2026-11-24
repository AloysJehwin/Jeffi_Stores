import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/admin/products',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }), useToastOptional: () => ({ showToast }) }))
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) }))
vi.mock('@/components/ui/HoverCard', () => ({ default: ({ trigger }: any) => <div>{trigger}</div> }))
vi.mock('@/components/ui/CopySku', () => ({ default: () => <span>copy</span> }))
vi.mock('@/components/shared/ProductWarningBadges', () => ({ default: () => null }))
vi.mock('@admin/app/(admin)/admin/products/_components/ProductImage', () => ({ default: () => <i /> }))
vi.mock('@admin/app/(admin)/admin/products/_components/FeaturedToggleButton', () => ({ default: () => <button>feature-toggle</button> }))
vi.mock('@admin/app/(admin)/admin/products/_components/ProductsMobileList', () => ({ default: () => <div>mobile</div> }))
vi.mock('@admin/app/(admin)/admin/products/_components/ProductDetailModal', () => ({ default: ({ product }: any) => (product ? <div>detail:{product.name}</div> : null) }))
vi.mock('@admin/app/(admin)/admin/products/_components/ProductLabelModal', () => ({ default: ({ product }: any) => (product ? <div>label:{product.name}</div> : null) }))
vi.mock('@/components/admin/DraftConfirmModal', () => ({ default: ({ productName }: any) => <div>draft-modal:{productName}</div> }))
vi.mock('@/components/admin/RowActions', () => ({
  default: ({ actions }: any) => (
    <div>
      {actions.filter((a: any) => !a.hidden).map((a: any) => (a.href ? <a key={a.key} href={a.href}>{a.label}</a> : <button key={a.key} onClick={() => a.onSelect()}>{a.label}</button>))}
    </div>
  ),
}))

import ProductsTableClient from '@admin/app/(admin)/admin/products/ProductsTableClient'

const products = [
  { id: 'p1', name: 'Power Drill', sku: 'PD-1', is_active: true, is_featured: true, has_variants: false, base_price: 1999, mrp: 2499, inventory_quantity: 12, stock_status: 'In Stock', categories: { name: 'Tools' }, brands: { name: 'Acme' }, product_images: [] },
  { id: 'p2', name: 'Paint Set', sku: 'PS-2', is_active: false, is_featured: false, has_variants: true, variant_min_price: 300, variant_min_mrp: 300, variant_inventory_total: 0, variant_stock_total: 4, stock_status: 'Out of Stock', categories: null, brands: null, product_images: [] },
]
const pageUrls = { first: '/admin/products', template: '/admin/products?page=987654321' }
const base = { products, featuredCount: 1, total: 2, page: 1, pageSize: 25, pageUrls }
const fetchMock = vi.fn()
const json = (ok: boolean, body: unknown = {}) => ({ ok, json: async () => body })

describe('ProductsTableClient', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(json(true))
    vi.stubGlobal('fetch', fetchMock)
  })

  it('renders rows with price, MRP strike-through, stock and status', () => {
    render(asAdmin(<ProductsTableClient {...base} />))
    expect(screen.getAllByText('Power Drill').length).toBeGreaterThan(0)
    expect(screen.getByText('Rs. 1,999.00')).toBeInTheDocument()
    expect(screen.getByText('Rs. 2,499.00')).toBeInTheDocument()
    expect(screen.getByText('From Rs. 300.00')).toBeInTheDocument()
    expect(screen.getByText('Out')).toBeInTheDocument()
    expect(screen.getAllByText('Tools').length).toBeGreaterThan(0)
    expect(screen.getAllByText('N/A').length).toBeGreaterThan(0)
  })

  it('shows the empty state', () => {
    render(asAdmin(<ProductsTableClient {...base} products={[]} total={0} />))
    expect(screen.getByText('No products found.')).toBeInTheDocument()
  })

  it('clicking a row opens the detail modal', () => {
    render(asAdmin(<ProductsTableClient {...base} />))
    fireEvent.click(screen.getAllByText('PS-2')[0])
    expect(screen.getByText('detail:Paint Set')).toBeInTheDocument()
  })

  it('toggles status optimistically and PATCHes is_active', async () => {
    render(asAdmin(<ProductsTableClient {...base} canWrite />))
    fireEvent.click(screen.getByTitle('Click to deactivate'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toBe('/api/products/p1')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ is_active: false })
    expect(screen.queryByTitle('Click to deactivate')).not.toBeInTheDocument()
  })

  it('reverts the toggle and toasts when the update fails', async () => {
    fetchMock.mockResolvedValue(json(false))
    render(asAdmin(<ProductsTableClient {...base} canWrite />))
    fireEvent.click(screen.getByTitle('Click to deactivate'))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Failed to update status', 'error'))
    expect(screen.getByTitle('Click to deactivate')).toBeInTheDocument()
  })

  it('opens the draft modal for an active product and links edit for an inactive one', () => {
    render(asAdmin(<ProductsTableClient {...base} canWrite />))
    const edits = screen.getAllByText('Edit Product')
    expect(edits).toHaveLength(2)
    expect(edits[1].closest('a')).toHaveAttribute('href', expect.stringContaining('/admin/products/p2/edit?back='))
    fireEvent.click(edits[0])
    expect(screen.getByText('draft-modal:Power Drill')).toBeInTheDocument()
  })

  it('delete is only offered to super admins with write and surfaces the API error', async () => {
    const { unmount } = render(asAdmin(<ProductsTableClient {...base} canWrite />))
    expect(screen.queryByText('Delete Product')).not.toBeInTheDocument()
    unmount()
    fetchMock.mockResolvedValue(json(false, { error: 'Has open orders' }))
    render(asAdmin(<ProductsTableClient {...base} canWrite isSuperAdmin />))
    fireEvent.click(screen.getAllByText('Delete Product')[0])
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Has open orders', 'error'))
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/products/p1', { method: 'DELETE' })
  })

  it('print label needs the labels scope and opens the label modal', () => {
    const { unmount } = render(asMember(<ProductsTableClient {...base} />, ['products:read']))
    expect(screen.queryByText('Print Label')).not.toBeInTheDocument()
    unmount()
    render(asAdmin(<ProductsTableClient {...base} />, ['labels:read']))
    fireEvent.click(screen.getAllByText('Print Label')[0])
    expect(screen.getByText('label:Power Drill')).toBeInTheDocument()
  })

  it('is read-only without write: no edit actions, no feature toggles, status is disabled', () => {
    render(asAdmin(<ProductsTableClient {...base} />))
    expect(screen.queryByText('Edit Product')).not.toBeInTheDocument()
    expect(screen.queryByText('feature-toggle')).not.toBeInTheDocument()
    expect(screen.getAllByText('Active')[0].closest('button')).toBeDisabled()
    expect(screen.getAllByText('View Details')).toHaveLength(2)
  })
})
