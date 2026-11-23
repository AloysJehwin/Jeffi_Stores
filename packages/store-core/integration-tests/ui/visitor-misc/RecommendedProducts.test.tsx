import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

// ProductCard is exercised by its own suite; stub it to a marker carrying the key props we map.
vi.mock('@/components/visitor/ProductCard', () => ({
  default: (p: any) => (
    <div data-testid="product-card" data-name={p.name} data-price={p.displayPrice} data-discount={p.mrpDiscount} />
  ),
}))

import RecommendedProducts from '@/components/visitor/RecommendedProducts'

const product = (over: Record<string, any> = {}) => ({
  id: 'p1',
  name: 'Blue Mug',
  slug: 'blue-mug',
  base_price: 299,
  price_ex_gst: null,
  mrp: 499,
  has_variants: false,
  variant_min_price: null,
  variant_min_mrp: null,
  variant_stock_total: null,
  stock_status: 'In Stock',
  discount_pct: null,
  extra_delivery_days: null,
  product_images: [{ image_url: '/a.jpg', thumbnail_url: '/a-t.jpg', is_primary: true }],
  brands: { name: 'Acme' },
  categories: { name: 'Kitchen' },
  ...over,
})

function mockFetch(payload: any, ok = true) {
  global.fetch = vi.fn<(...a: any[]) => any>(() =>
    Promise.resolve({ ok, json: () => Promise.resolve(payload) })
  ) as any
}

describe('RecommendedProducts (render + mapping)', () => {
  beforeEach(() => {
    mockFetch({ products: [] })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders nothing when the API returns no products', async () => {
    mockFetch({ products: [] })
    const { container } = render(<RecommendedProducts />)
    await waitFor(() => expect(container.firstChild).toBeNull())
  })

  it('renders the default title and a card per product', async () => {
    mockFetch({ products: [product(), product({ id: 'p2', name: 'Red Mug' })] })
    render(<RecommendedProducts />)
    await screen.findByText('You Might Also Like')
    expect(screen.getAllByTestId('product-card')).toHaveLength(2)
    expect(screen.getByText('You Might Also Like')).toBeInTheDocument()
  })

  it('honours a custom title', async () => {
    mockFetch({ products: [product()] })
    render(<RecommendedProducts title="Picked for you" />)
    await screen.findByText('Picked for you')
  })

  it('computes the MRP discount percent passed to the card', async () => {
    // base 299 vs mrp 499 -> round(((499-299)/499)*100) = 40.
    mockFetch({ products: [product()] })
    render(<RecommendedProducts />)
    const card = await screen.findByTestId('product-card')
    expect(card).toHaveAttribute('data-price', '299')
    expect(card).toHaveAttribute('data-discount', '40')
  })

  it('caps the rendered cards at the limit prop', async () => {
    mockFetch({ products: [product(), product({ id: 'p2' }), product({ id: 'p3' }), product({ id: 'p4' }), product({ id: 'p5' })] })
    render(<RecommendedProducts limit={2} />)
    await waitFor(() => expect(screen.getAllByTestId('product-card')).toHaveLength(2))
  })
})
