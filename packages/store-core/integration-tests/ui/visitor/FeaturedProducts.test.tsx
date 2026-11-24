import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))

import FeaturedProducts from '@/components/visitor/FeaturedProducts'

const fetchMock = vi.fn()
const product = (i: number, over: Record<string, any> = {}) => ({
  id: `p${i}`,
  name: `Product ${i}`,
  slug: `product-${i}`,
  base_price: 1000,
  mrp: null,
  variant_min_price: null,
  has_variants: false,
  product_images: [{ thumbnail_url: `/t${i}.png`, is_primary: true }],
  ...over,
})
const ok = (products: any[]) => fetchMock.mockResolvedValue({ ok: true, json: async () => ({ products }) })

describe('FeaturedProducts', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('requests the four most popular products', async () => {
    ok([])
    render(<FeaturedProducts />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/products?sort=popular&limit=4'))
  })

  it('renders nothing while empty or when the request fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) })
    const { container } = render(<FeaturedProducts />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('swallows a network error', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    const { container } = render(<FeaturedProducts />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('shows product cards with links, prices, strike-through MRP and discount badge', async () => {
    ok([product(1, { mrp: 2000 }), product(2)])
    render(<FeaturedProducts />)
    expect(await screen.findByText('You might also like')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Product 1/ })).toHaveAttribute('href', '/products/product-1')
    expect(screen.getByText('50% off')).toBeInTheDocument()
    expect(screen.getByText('₹2,000')).toHaveClass('line-through')
    expect(screen.getAllByText('₹1,000')).toHaveLength(2)
    expect(screen.getByAltText('Product 2')).toBeInTheDocument()
  })

  it('uses the lowest variant price and a placeholder when there is no image; caps at four', async () => {
    ok([
      product(1, { has_variants: true, variant_min_price: 750, product_images: [] }),
      product(2), product(3), product(4), product(5),
    ])
    render(<FeaturedProducts />)
    expect(await screen.findByText('₹750')).toBeInTheDocument()
    expect(screen.queryByAltText('Product 1')).not.toBeInTheDocument()
    expect(screen.queryByText('Product 5')).not.toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(4)
  })
})
