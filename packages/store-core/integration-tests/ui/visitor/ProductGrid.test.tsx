import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const push = vi.fn()
const replace = vi.fn()
let params = new URLSearchParams()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace }), useSearchParams: () => params }))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
vi.mock('@/components/visitor/ProductCard', () => ({
  default: (p: any) => (
    <div data-testid="card" data-price={p.displayPrice} data-mrp={p.mrp ?? ''} data-off={p.mrpDiscount} data-stock={p.effectiveStock} data-portal={p.portal}>
      {p.name}
    </div>
  ),
}))
vi.mock('@/components/visitor/SortDropdown', () => ({ default: ({ basePath }: any) => <div data-testid="sort" data-base={basePath} /> }))
vi.mock('@/components/admin/kit/infinite', () => ({
  ServerPagedItems: ({ items, page, total, wrapClassName }: any) => (
    <div data-testid="paged" data-page={page} data-total={total} className={wrapClassName}>
      {items.map((i: any) => (
        <span key={i.key}>{i.node}</span>
      ))}
    </div>
  ),
}))

import ProductGrid from '@/components/visitor/ProductGrid'

const product = (i: number, over: Record<string, any> = {}) => ({
  id: `p${i}`, name: `Product ${i}`, slug: `product-${i}`, base_price: 1180, price_ex_gst: 1000, mrp: 1500, gst_percentage: 18,
  has_variants: false, variant_min_price: null, variant_min_mrp: null, variant_stock_total: 0, stock_status: 'In Stock', discount_pct: 0,
  is_featured: false, extra_delivery_days: 0, handling_days: 2,
  product_images: [{ image_url: `/p${i}.png`, thumbnail_url: `/t${i}.png`, is_primary: true }],
  brands: { id: 'b1', name: 'Halo' }, categories: { id: 'c1', name: 'Audio', slug: 'audio' },
  ...over,
})

describe('ProductGrid', () => {
  beforeEach(() => {
    push.mockReset()
    replace.mockReset()
    params = new URLSearchParams()
  })

  it('renders a product card per product with GST-aware price, MRP and discount', () => {
    render(<ProductGrid products={[product(1)]} gstEnabled={false} />)
    const card = screen.getByTestId('card')
    expect(card).toHaveAttribute('data-price', '1000')
    expect(card).toHaveAttribute('data-mrp', '1271.19')
    expect(card).toHaveAttribute('data-off', '21')
    expect(card).toHaveAttribute('data-portal', 'storefront')
  })

  it('with GST on it uses the inclusive price and the raw MRP', () => {
    render(<ProductGrid products={[product(1)]} gstEnabled />)
    const card = screen.getByTestId('card')
    expect(card).toHaveAttribute('data-price', '1180')
    expect(card).toHaveAttribute('data-mrp', '1500')
    expect(card).toHaveAttribute('data-off', '21')
  })

  it('variant products show the lowest variant price and stock from variants', () => {
    render(<ProductGrid products={[product(1, { has_variants: true, variant_min_price: 800, variant_min_mrp: 1000, variant_stock_total: 0 })]} gstEnabled />)
    const card = screen.getByTestId('card')
    expect(card).toHaveAttribute('data-price', '800')
    expect(card).toHaveAttribute('data-stock', '0')
    expect(card).toHaveAttribute('data-off', '20')
  })

  it('marks out-of-stock simple products as zero stock', () => {
    render(<ProductGrid products={[product(1, { stock_status: 'Out of Stock' })]} gstEnabled />)
    expect(screen.getByTestId('card')).toHaveAttribute('data-stock', '0')
  })

  it('the control bar: sort dropdown in grid view, hidden when controls are off', () => {
    const a = render(<ProductGrid products={[product(1)]} gstEnabled basePath="/brands/halo" />)
    expect(screen.getByTestId('sort')).toHaveAttribute('data-base', '/brands/halo')
    a.unmount()
    render(<ProductGrid products={[product(1)]} gstEnabled controls={false} />)
    expect(screen.queryByTestId('sort')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Grid view' })).not.toBeInTheDocument()
  })

  it('renders the filter slot inside the control bar', () => {
    render(<ProductGrid products={[product(1)]} gstEnabled filterSlot={<button>Filters</button>} />)
    expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument()
  })

  it('"Group by Category" toggles the sort=category param and clears paging', () => {
    params = new URLSearchParams('page=3&dir=asc&q=x')
    render(<ProductGrid products={[product(1)]} gstEnabled />)
    const btn = screen.getByRole('button', { name: /Group/ })
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(btn)
    const qs = new URLSearchParams(String(push.mock.calls[0][0]).slice(1))
    expect(qs.get('sort')).toBe('category')
    expect(qs.get('q')).toBe('x')
    expect(qs.has('page')).toBe(false)
    expect(qs.has('dir')).toBe(false)
  })

  it('grouped view draws a header per category and removes the toggle sort when switched off', () => {
    params = new URLSearchParams('sort=category')
    render(
      <ProductGrid
        products={[product(1), product(2, { categories: { id: 'c2', name: 'Cables', slug: 'cables' } }), product(3, { categories: null })]}
        gstEnabled
      />
    )
    expect(screen.getByRole('link', { name: 'Audio' })).toHaveAttribute('href', '/categories/audio')
    expect(screen.getByRole('link', { name: 'Cables' })).toBeInTheDocument()
    expect(screen.getByText('Other')).toBeInTheDocument()
    expect(screen.getAllByText('1 products')).toHaveLength(3)
    const btn = screen.getByRole('button', { name: /Group/ })
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(btn)
    expect(String(push.mock.calls[0][0])).toBe('?')
  })

  it('table view lists rows with price, MRP strike-through, discount and stock badge', () => {
    render(
      <ProductGrid
        products={[
          product(1, { grade: 'A', material: 'Steel' }),
          product(2, { stock_status: 'Low Stock', mrp: null }),
          product(3, { stock_status: 'Out of Stock' }),
        ]}
        gstEnabled
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }))
    expect(screen.getByRole('button', { name: 'Table view' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('card')).not.toBeInTheDocument()
    expect(screen.queryByTestId('sort')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Product 1/ })).toHaveAttribute('href', '/products/product-1')
    expect(screen.getByText('Steel')).toBeInTheDocument()
    expect(screen.getAllByText('₹1,180.00').length).toBeGreaterThan(0)
    expect(screen.getAllByText('₹1,500.00')[0]).toHaveClass('line-through')
    expect(screen.getAllByText('-21%').length).toBeGreaterThan(0)
    expect(screen.getByText('Low Stock')).toBeInTheDocument()
    expect(screen.getByText('Out of Stock')).toBeInTheDocument()
    expect(screen.getAllByText('In Stock')).toHaveLength(1)
  })

  it('table column headers sort: natural, flipped, then cleared', () => {
    const a = render(<ProductGrid products={[product(1)]} gstEnabled basePath="/products" />)
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }))
    fireEvent.click(screen.getByRole('button', { name: /Price/ }))
    expect(replace).toHaveBeenLastCalledWith('/products?sort=price&dir=asc', { scroll: false })
    a.unmount()
    params = new URLSearchParams('sort=price&dir=asc&page=2')
    render(<ProductGrid products={[product(1)]} gstEnabled basePath="/products" />)
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }))
    const price = screen.getByRole('button', { name: /Price/ })
    expect(price).toHaveAttribute('aria-sort', 'ascending')
    fireEvent.click(price)
    expect(replace).toHaveBeenLastCalledWith('/products?sort=price&dir=desc', { scroll: false })
  })

  it('table view clears sort when the third click removes it', () => {
    params = new URLSearchParams('sort=price&dir=desc')
    render(<ProductGrid products={[product(1)]} gstEnabled basePath="/products" />)
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }))
    const price = screen.getByRole('button', { name: /Price/ })
    expect(price).toHaveAttribute('aria-sort', 'descending')
    fireEvent.click(price)
    expect(replace).toHaveBeenLastCalledWith('/products', { scroll: false })
  })

  it('switching back to grid shows cards again', () => {
    render(<ProductGrid products={[product(1)]} gstEnabled />)
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }))
    fireEvent.click(screen.getByRole('button', { name: 'Grid view' }))
    expect(screen.getByTestId('card')).toBeInTheDocument()
  })

  it('infinite grid: hands the server-drawn items to the pager with page and total', () => {
    render(
      <ProductGrid
        products={[product(1)]}
        gstEnabled
        page={2}
        total={120}
        gridClassName="my-grid"
        pagedItems={[{ key: 'p1', node: <b>server card</b> }] as any}
      />
    )
    const paged = screen.getByTestId('paged')
    expect(paged).toHaveAttribute('data-page', '2')
    expect(paged).toHaveAttribute('data-total', '120')
    expect(paged).toHaveClass('my-grid')
    expect(screen.getByText('server card')).toBeInTheDocument()
    expect(screen.queryByTestId('card')).not.toBeInTheDocument()
  })

  it('grouped view with site cards uses the server-drawn card instead of ProductCard', () => {
    params = new URLSearchParams('sort=category')
    render(
      <ProductGrid
        products={[product(1), product(2)]}
        gstEnabled
        page={1}
        total={2}
        pagedItems={[{ key: 'p1', card: true, node: <b>site card 1</b> }] as any}
      />
    )
    expect(screen.getByText('site card 1')).toBeInTheDocument()
    expect(screen.getAllByTestId('card')).toHaveLength(1)
  })

  it('injects a "Top Categories" banner row every 12 products, rotating the categories shown', () => {
    const products = Array.from({ length: 13 }, (_, i) => product(i))
    const banners = [
      { id: 'k1', name: 'Fasteners', slug: 'fasteners', products: [{ id: 'x1', name: 'Bolt', slug: 'bolt', has_variants: false, base_price: 50, price_ex_gst: 42, variant_min_price: null, product_images: [{ image_url: '/b.png' }] }] },
      { id: 'k2', name: 'Cables', slug: 'cables', products: [] },
    ]
    render(<ProductGrid products={products} gstEnabled categoryBanners={banners as any} />)
    expect(screen.getAllByText('Top Categories')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'All categories' })).toHaveAttribute('href', '/categories')
    expect(screen.getByRole('link', { name: 'Fasteners' })).toHaveAttribute('href', '/categories/fasteners')
    expect(screen.getByRole('link', { name: /Bolt/ })).toHaveAttribute('href', '/products/bolt')
    expect(screen.getByText('₹50')).toBeInTheDocument()
  })

  it('shows no banner for short lists or without banners', () => {
    render(<ProductGrid products={Array.from({ length: 5 }, (_, i) => product(i))} gstEnabled categoryBanners={[{ id: 'k', name: 'K', slug: 'k', products: [] }]} />)
    expect(screen.queryByText('Top Categories')).not.toBeInTheDocument()
  })

  it('the business portal links under /business and tells the cards', () => {
    render(<ProductGrid products={[product(1)]} gstEnabled portal="business" />)
    expect(screen.getByTestId('card')).toHaveAttribute('data-portal', 'business')
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }))
    expect(screen.getByRole('link', { name: /Product 1/ }).getAttribute('href')).toBe('/business/products/product-1')
  })

  it('renders an empty grid for no products', () => {
    render(<ProductGrid products={[]} gstEnabled />)
    expect(screen.queryByTestId('card')).not.toBeInTheDocument()
  })
})
