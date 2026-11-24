import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => <a href={typeof href === 'string' ? href : '#'} {...rest}>{children}</a>,
}))
vi.mock('@/components/visitor/ProductCard', () => ({
  default: ({ id, badge, imageAspect, portal }: any) => (
    <div data-testid="product" data-id={id} data-badge={badge ?? ''} data-aspect={imageAspect ?? ''} data-portal={portal ?? ''} />
  ),
}))
vi.mock('@/components/visitor/SectionCarousel', () => ({
  default: ({ children, ariaLabel }: any) => <div data-testid="carousel" aria-label={ariaLabel}>{children}</div>,
}))
vi.mock('@/lib/catalog/product-card-props', () => ({
  productCardProps: (p: any) => ({ id: p.id }),
}))

import ProductRowSection from '@/components/visitor/home/ProductRowSection'

const base = {
  title: 'New arrivals',
  eyebrow: 'Fresh',
  products: [{ id: 'a' }, { id: 'b' }],
  gstEnabled: false,
  viewAllHref: '/products?sort=new',
  viewAllLabel: 'View all',
  sectionClassName: 'sec',
  headingClassName: 'head',
  eyebrowClassName: 'eyebrow',
  gridClassName: 'the-grid',
}

describe('ProductRowSection', () => {
  it('renders heading, eyebrow, a product card per product, and the view-all link', () => {
    const { container } = render(<ProductRowSection {...base} />)
    expect(screen.getByRole('heading', { name: 'New arrivals' })).toBeInTheDocument()
    expect(screen.getByText('Fresh')).toBeInTheDocument()
    expect(screen.getAllByTestId('product')).toHaveLength(2)
    expect(container.querySelector('.the-grid')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /View all/ })).toHaveAttribute('href', '/products?sort=new')
    expect(screen.queryByTestId('carousel')).toBeNull()
  })

  it('passes badges, image aspect and portal to each card', () => {
    render(<ProductRowSection {...base} badgeFor={p => (p.id === 'a' ? 'NEW' : null)} imageAspect={1.25} portal="business" />)
    const cards = screen.getAllByTestId('product')
    expect(cards[0].dataset.badge).toBe('NEW')
    expect(cards[1].dataset.badge).toBe('')
    expect(cards[0].dataset.aspect).toBe('1.25')
    expect(cards[0].dataset.portal).toBe('business')
  })

  it('puts an accent bar beside the heading, a footer CTA below and the inline arrow label', () => {
    const { container } = render(
      <ProductRowSection {...base} accentBarClassName="bar" footerCta={{ href: '/all', label: 'Browse everything' }} inlineViewAllArrow />,
    )
    expect(container.querySelector('.bar')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Browse everything/ })).toHaveAttribute('href', '/all')
    expect(screen.getByRole('link', { name: /View all/ })).toBeInTheDocument()
  })

  it('uses the carousel labelled with the title', () => {
    render(<ProductRowSection {...base} carousel />)
    expect(screen.getByTestId('carousel')).toHaveAttribute('aria-label', 'New arrivals')
    expect(screen.getAllByTestId('product')).toHaveLength(2)
  })

  it('omits the view-all link without a href and shows no cards for no products', () => {
    render(<ProductRowSection {...base} viewAllHref="" products={[]} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByTestId('product')).toBeNull()
  })
})
