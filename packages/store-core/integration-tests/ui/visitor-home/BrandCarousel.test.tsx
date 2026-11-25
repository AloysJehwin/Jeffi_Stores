import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => <a href={typeof href === 'string' ? href : '#'} {...rest}>{children}</a>,
}))
vi.mock('@/components/visitor/SectionCarousel', () => ({
  default: ({ children, ariaLabel }: any) => <div data-testid="carousel" aria-label={ariaLabel}>{children}</div>,
}))

import BrandCarousel from '@/components/visitor/home/BrandCarousel'

const brands = [
  { id: '1', name: 'Bosch', slug: 'bosch', logo_url: 'https://cdn.test/bosch.png', product_count: 12 },
  { id: '2', name: 'Makita', slug: 'makita', logo_url: null, product_count: 3 },
]

describe('BrandCarousel', () => {
  it('lists brands as links with counts, a logo or initials fallback', () => {
    const { container } = render(<BrandCarousel brands={brands} />)
    expect(screen.getByRole('heading', { name: 'Shop by Brand' })).toBeInTheDocument()
    expect(screen.getByText('Trusted Names')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Bosch/ })).toHaveAttribute('href', '/brands/bosch')
    expect(screen.getByRole('link', { name: /Makita/ })).toHaveAttribute('href', '/brands/makita')
    expect(screen.getByText('12 items')).toBeInTheDocument()
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.test/bosch.png')
    expect(screen.getByText('MA')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /All brands/ })).toHaveAttribute('href', '/brands')
    expect(screen.queryByTestId('carousel')).toBeNull()
  })

  it('wraps the tiles in a carousel when asked, labelled with the title', () => {
    render(<BrandCarousel brands={brands} carousel title="Our brands" eyebrow="Partners" />)
    expect(screen.getByTestId('carousel')).toHaveAttribute('aria-label', 'Our brands')
    expect(screen.getByText('Partners')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /items/ })).toHaveLength(2)
  })

  it('renders only the heading with no brands', () => {
    render(<BrandCarousel brands={[]} />)
    expect(screen.getByRole('heading', { name: 'Shop by Brand' })).toBeInTheDocument()
    expect(screen.queryByText(/items$/)).toBeNull()
  })
})
