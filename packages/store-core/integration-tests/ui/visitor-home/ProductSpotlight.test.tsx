import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const quickAdd = vi.hoisted(() => ({ props: null as any }))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => <a href={typeof href === 'string' ? href : '#'} {...rest}>{children}</a>,
}))
vi.mock('@/components/visitor/StoreImage', () => ({ default: ({ src, alt }: any) => <img src={src} alt={alt} /> }))
vi.mock('@/components/visitor/QuickAddButton', () => ({
  default: (p: any) => {
    quickAdd.props = p
    return <span data-testid="quick-add" data-signal={p.openSignal} />
  },
}))
vi.mock('motion/react', async () => {
  const React = await import('react')
  const strip = (tag: string) => function Stripped({ children, className }: any) {
    return React.createElement(tag, { className }, children)
  }
  return {
    motion: { div: strip('div') },
    useReducedMotion: () => false,
    useScroll: () => ({ scrollYProgress: {} }),
    useTransform: () => ({}),
  }
})

import ProductSpotlight from '@/components/visitor/home/ProductSpotlight'

const product = {
  id: 'p1',
  slug: 'espresso-maker',
  name: 'Espresso Maker',
  brandName: 'Brewco',
  categoryName: 'Kitchen',
  primaryImage: { image_url: '/e.jpg', thumbnail_url: '/e-t.jpg', blurhash: null },
  mrp: 12000,
  displayPrice: 9000,
  mrpDiscount: 25,
  discountPct: 0,
  hasVariants: false,
  isDigital: false,
  effectiveStock: 5,
} as any

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as any
})

describe('ProductSpotlight', () => {
  it('shows the product, prices, discount and a View product link', () => {
    render(<ProductSpotlight product={product} headline={null} callouts={[]} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Espresso Maker' })).toBeInTheDocument()
    expect(screen.getByAltText('Espresso Maker')).toHaveAttribute('src', '/e.jpg')
    expect(screen.getByText('Brewco')).toBeInTheDocument()
    expect(screen.getByText('₹9,000.00')).toBeInTheDocument()
    expect(screen.getByText('₹12,000.00')).toHaveClass('line-through')
    expect(screen.getAllByText('25% off')).toHaveLength(2)
    expect(screen.getByRole('link', { name: /View product/ })).toHaveAttribute('href', '/products/espresso-maker')
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('uses the headline as the title, linking the product name under it, and lists callouts', () => {
    render(<ProductSpotlight product={product} headline="Barista at home" callouts={['15 bar pump', 'Steam wand']} eyebrow="Spotlight" ctaLabel="Add to bag" />)
    expect(screen.getByRole('heading', { name: 'Barista at home' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Espresso Maker' })).toHaveAttribute('href', '/products/espresso-maker')
    expect(screen.getAllByRole('listitem').map(li => li.textContent)).toEqual(['15 bar pump', 'Steam wand'])
    expect(screen.getByText('Spotlight')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to bag' })).toBeEnabled()
  })

  it('opens the quick-add flow from the CTA button', () => {
    render(<ProductSpotlight product={product} headline={null} callouts={[]} />)
    expect(screen.getByTestId('quick-add')).toHaveAttribute('data-signal', '0')
    expect(quickAdd.props).toMatchObject({ productId: 'p1', inStock: true, imageUrl: '/e-t.jpg', discountPct: 25, displayPrice: 9000 })
    fireEvent.click(screen.getAllByRole('button').find(b => b.textContent !== '')!)
    expect(screen.getByTestId('quick-add')).toHaveAttribute('data-signal', '1')
  })

  it('shows Out of stock with a disabled button when nothing is available, unless digital', () => {
    const out = { ...product, effectiveStock: 0 }
    const { rerender } = render(<ProductSpotlight product={out} headline={null} callouts={[]} />)
    expect(screen.getByRole('button', { name: 'Out of stock' })).toBeDisabled()
    rerender(<ProductSpotlight product={{ ...out, isDigital: true }} headline={null} callouts={[]} />)
    expect(screen.queryByRole('button', { name: 'Out of stock' })).toBeNull()
  })

  it('prefixes variant prices with From, hides MRP/discount without one, and shows a placeholder without an image', () => {
    const { container } = render(
      <ProductSpotlight product={{ ...product, hasVariants: true, mrp: null, mrpDiscount: 0, primaryImage: null, brandName: null }} headline={null} callouts={[]} />,
    )
    expect(screen.getByText(/From\s*₹9,000\.00/)).toBeInTheDocument()
    expect(screen.queryByText(/% off/)).toBeNull()
    expect(screen.queryByAltText('Espresso Maker')).toBeNull()
    expect(container.querySelector('svg.lucide-package')).toBeInTheDocument()
  })
})
