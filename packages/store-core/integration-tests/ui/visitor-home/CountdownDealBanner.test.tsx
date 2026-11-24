import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => <a href={typeof href === 'string' ? href : '#'} {...rest}>{children}</a>,
}))
vi.mock('@/components/visitor/StoreImage', () => ({
  default: ({ src, alt }: any) => <img src={src} alt={alt} />,
}))
vi.mock('@/components/visitor/home/DealCountdown', () => ({
  default: ({ endsAt }: { endsAt: string }) => <div data-testid="countdown">{endsAt}</div>,
}))

import CountdownDealBanner from '@/components/visitor/home/CountdownDealBanner'

const product = {
  slug: 'power-drill',
  name: 'Power Drill',
  brandName: 'Bosch',
  primaryImage: { image_url: '/drill.jpg', blurhash: null },
  mrp: 5000,
  displayPrice: 3999,
  mrpDiscount: 20,
  hasVariants: false,
} as any

describe('CountdownDealBanner', () => {
  it('shows the product, prices, discount, countdown and CTA linking to the product', () => {
    render(<CountdownDealBanner product={product} endsAt="2026-12-01T00:00:00Z" />)
    expect(screen.getByRole('heading', { name: 'Deal ends soon' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Grab the deal' })).toBeInTheDocument()
    expect(screen.getByText('Bosch')).toBeInTheDocument()
    expect(screen.getByAltText('Power Drill')).toHaveAttribute('src', '/drill.jpg')
    expect(screen.getByText('₹3,999.00')).toBeInTheDocument()
    expect(screen.getByText('₹5,000.00')).toHaveClass('line-through')
    expect(screen.getByText('20% off')).toBeInTheDocument()
    expect(screen.getByText('Offer ends in')).toBeInTheDocument()
    expect(screen.getByTestId('countdown')).toHaveTextContent('2026-12-01T00:00:00Z')
    for (const link of screen.getAllByRole('link')) expect(link).toHaveAttribute('href', '/products/power-drill')
  })

  it('uses custom copy, prefixes variant prices with From and hides the MRP when not higher', () => {
    render(
      <CountdownDealBanner
        product={{ ...product, hasVariants: true, mrp: 3999, mrpDiscount: 0, brandName: null }}
        endsAt={null}
        title="Hot buy"
        eyebrow="Today only"
        ctaLabel="Grab it"
        aspect={1.5}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Hot buy' })).toBeInTheDocument()
    expect(screen.getByText('Today only')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Grab it' })).toBeInTheDocument()
    expect(screen.getByText(/From\s*₹3,999\.00/)).toBeInTheDocument()
    expect(screen.queryByText(/% off/)).toBeNull()
    expect(screen.queryByTestId('countdown')).toBeNull()
    expect(screen.queryByText('Offer ends in')).toBeNull()
  })

  it('shows a placeholder icon when the product has no image', () => {
    const { container } = render(<CountdownDealBanner product={{ ...product, primaryImage: null }} endsAt={null} />)
    expect(screen.queryByAltText('Power Drill')).toBeNull()
    expect(container.querySelector('svg.lucide-package')).toBeInTheDocument()
  })
})
