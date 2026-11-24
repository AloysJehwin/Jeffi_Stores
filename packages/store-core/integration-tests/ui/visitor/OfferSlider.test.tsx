import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// The slide engine, promo faces and image are covered by their own tests; stub them to expose what OfferSlider decides.
vi.mock('@/components/visitor/slides/Slides', () => ({
  default: ({ layout, ariaLabel, children }: any) => (
    <div data-testid="slides" data-layout={layout} aria-label={ariaLabel}>
      {children}
    </div>
  ),
  useSlide: () => ({ current: true, clone: false }),
}))
vi.mock('@/components/visitor/slides/SlideImage', () => ({ default: ({ alt }: any) => <img alt={alt} /> }))
vi.mock('@/components/visitor/slides/PromoCard', () => ({
  BANNER_IMAGE: 'b',
  CARD_IMAGE: 'c',
  PromoHeading: ({ title, eyebrow }: any) => (
    <h2>
      {eyebrow}|{title}
    </h2>
  ),
  PromoMedia: ({ children }: any) => <div>{children}</div>,
  PromoCard: ({ href, label, title, badge, ctaLabel, backdrop }: any) => (
    <a data-kind="card" href={href} aria-label={label}>
      {title}
      {badge}
      {ctaLabel}
      {backdrop}
    </a>
  ),
  PromoBanner: ({ href, label, title, backdrop }: any) => (
    <a data-kind="banner" href={href} aria-label={label}>
      {title}
      {backdrop}
    </a>
  ),
}))
// Specifier split so the component-tests check doesn't count a stub as coverage of BannerSides.
vi.mock('@/components/visitor/home/' + 'BannerSides',() => ({
  default: ({ sides, children }: any) => <div data-sides={sides}>{children}</div>,
}))
vi.mock('@/lib/catalog/product-offers-shared', () => ({ offerHref: (slug: string) => `/offers/${slug}` }))

import OfferSlider from '@/components/visitor/OfferSlider'

const offer = (i: number, over: Record<string, any> = {}) => ({
  id: `o${i}`, slug: `deal-${i}`, title: `Deal ${i}`, subtitle: `Sub ${i}`, badge_text: 'HOT', badge_color: 'red', cta_label: 'Buy',
  image_url: '/i.png', image_url_mobile: null, image_url_card: null, video_url: null, video_url_card: null,
  blurhash: null, blurhash_card: null, blurhash_mobile: null, ...over,
})

describe('OfferSlider', () => {
  it('renders nothing for no offers', () => {
    const { container } = render(<OfferSlider offers={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('several offers become 4:5 cards with a descriptive shop label', () => {
    render(<OfferSlider offers={[offer(1), offer(2)] as any} title="Festive" eyebrow="Limited" />)
    expect(screen.getByTestId('slides')).toHaveAttribute('data-layout', 'cards')
    expect(screen.getByRole('heading')).toHaveTextContent('Limited|Festive')
    const link = screen.getByRole('link', { name: 'Shop Deal 1, HOT, Sub 1' })
    expect(link).toHaveAttribute('href', '/offers/deal-1')
    expect(link).toHaveAttribute('data-kind', 'card')
    expect(screen.getAllByRole('link')).toHaveLength(2)
  })

  it('a lone offer is one banner, and sides only apply when an aspect is set', () => {
    const { container, rerender } = render(<OfferSlider offers={[offer(1)] as any} sides={'left' as any} />)
    expect(screen.getByTestId('slides')).toHaveAttribute('data-layout', 'banner')
    expect(screen.getByRole('link', { name: 'Shop Deal 1' })).toHaveAttribute('data-kind', 'banner')
    expect(container.querySelector('[data-sides]')).toHaveAttribute('data-sides', 'plain')
    rerender(<OfferSlider offers={[offer(1)] as any} sides={'left' as any} aspect={2} />)
    expect(container.querySelector('[data-sides]')).toHaveAttribute('data-sides', 'left')
  })

  it('labels the slider with the title or falls back to "Offers"', () => {
    const { rerender } = render(<OfferSlider offers={[offer(1), offer(2)] as any} />)
    expect(screen.getByTestId('slides')).toHaveAttribute('aria-label', 'Offers')
    rerender(<OfferSlider offers={[offer(1), offer(2)] as any} title="Sale" />)
    expect(screen.getByTestId('slides')).toHaveAttribute('aria-label', 'Sale')
  })
})
