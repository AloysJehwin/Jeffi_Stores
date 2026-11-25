import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => <a href={typeof href === 'string' ? href : '#'} {...rest}>{children}</a>,
}))
vi.mock('@/components/visitor/SectionCarousel', () => ({
  default: ({ children, ariaLabel }: any) => <div data-testid="carousel" aria-label={ariaLabel}>{children}</div>,
}))

import CategoryShowcase from '@/components/visitor/home/CategoryShowcase'

const item = (over: any = {}) => ({
  id: 'c1',
  name: 'Power Tools',
  slug: 'power-tools',
  products: [
    { id: 'p1', slug: 'drill', name: 'Drill', base_price: '1500', product_images: [{ image_url: '/d.jpg', thumbnail_url: '/d-t.jpg' }] },
    { id: 'p2', slug: 'saw', name: 'Saw', base_price: '2000', price_ex_gst: '1694', product_images: [] },
    { id: 'p3', slug: 'sander', name: 'Sander', has_variants: true, variant_min_price: '999', base_price: '1200', product_images: [] },
    { id: 'p4', slug: 'router', name: 'Router', base_price: '100', product_images: [] },
    { id: 'p5', slug: 'fifth', name: 'Fifth', base_price: '100', product_images: [] },
  ],
  ...over,
})

describe('CategoryShowcase', () => {
  it('shows the category link and at most four product tiles with prices', () => {
    const { container } = render(<CategoryShowcase items={[item()]} />)
    expect(screen.getByRole('heading', { name: /./ })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Power Tools' })[0]).toHaveAttribute('href', '/categories/power-tools')
    expect(screen.getByRole('link', { name: 'See all' })).toHaveAttribute('href', '/categories/power-tools')
    expect(screen.getByRole('link', { name: /Drill/ })).toHaveAttribute('href', '/products/drill')
    expect(screen.queryByText('Fifth')).toBeNull()
    expect(screen.getByText('₹1,500')).toBeInTheDocument()
    expect(screen.getByText('₹1,694')).toBeInTheDocument() // GST off: ex-GST price when present
    expect(screen.getByText('₹999')).toBeInTheDocument() // variant minimum wins
    expect(screen.getByAltText('Drill')).toHaveAttribute('src', '/d-t.jpg')
    expect(container.querySelectorAll('img')).toHaveLength(1)
    expect(screen.getByRole('link', { name: /All categories/ })).toHaveAttribute('href', '/categories')
  })

  it('uses the GST-inclusive price when GST pricing is enabled', () => {
    render(<CategoryShowcase items={[item()]} gstEnabled />)
    expect(screen.getByText('₹2,000')).toBeInTheDocument()
    expect(screen.queryByText('₹1,694')).toBeNull()
  })

  it('renders in a carousel with custom copy and a thumbnail aspect', () => {
    const { container } = render(<CategoryShowcase items={[item()]} carousel title="Top picks" eyebrow="Curated" aspect={0.75} />)
    expect(screen.getByTestId('carousel')).toHaveAttribute('aria-label', 'Top picks')
    expect(screen.getByText('Curated')).toBeInTheDocument()
    expect(container.querySelector('[style*="aspect-ratio"]')).toBeInTheDocument()
  })

  it('renders only the heading with no categories', () => {
    render(<CategoryShowcase items={[]} />)
    expect(screen.queryByRole('link', { name: /Power/ })).toBeNull()
  })
})
