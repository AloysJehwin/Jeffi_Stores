import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

import ListingPromoBanner, { pickPromoOffer, type PromoOffer } from '@/components/visitor/listing/ListingPromoBanner'

afterEach(cleanup)

const OFFER: PromoOffer = {
  slug: 'diwali',
  title: 'Diwali deals',
  subtitle: 'Up to 30% off',
  badge_text: 'Diwali',
  badge_color: 'bg-rose-600',
  image_url: 'https://cdn.example/d.jpg',
  image_url_mobile: null,
  blurhash: null,
  blurhash_mobile: null,
  cta_label: null,
}

describe('pickPromoOffer', () => {
  const offers = [
    { slug: 'a', image_url: 'a.jpg', image_url_mobile: null },
    { slug: 'no-image', image_url: null, image_url_mobile: null },
    { slug: 'b', image_url: null, image_url_mobile: 'b.jpg' },
    { slug: 'empty', image_url: 'e.jpg', image_url_mobile: null },
  ]
  const eligibleSlugs = new Set(['a', 'b', 'no-image'])

  it('only features offers with an image that hold products', () => {
    expect(pickPromoOffer(offers, { page: 1, eligibleSlugs })?.slug).toBe('a')
    expect(pickPromoOffer(offers, { page: 2, eligibleSlugs })?.slug).toBe('b')
    expect(pickPromoOffer(offers, { page: 3, eligibleSlugs })?.slug).toBe('a')
  })

  it('skips the offer that is already the active filter', () => {
    expect(pickPromoOffer(offers, { page: 1, activeSlug: 'a', eligibleSlugs })?.slug).toBe('b')
    expect(pickPromoOffer(offers, { page: 1, activeSlug: 'a', eligibleSlugs: new Set(['a']) })).toBeNull()
  })

  it('falls back to the first candidate for a bad page number', () => {
    expect(pickPromoOffer(offers, { page: Number.NaN, eligibleSlugs })?.slug).toBe('a')
  })
})

describe('ListingPromoBanner', () => {
  it('links to the offer-filtered listing like the offer slider does', () => {
    render(<ListingPromoBanner offer={OFFER} />)
    const link = screen.getByRole('link', { name: 'Shop Diwali deals' })
    expect(link.getAttribute('href')).toBe('/products?offer=diwali')
    expect(screen.getByText('Diwali').className).toContain('bg-rose-600')
    expect(screen.getByText('Shop the offer')).toBeTruthy()
  })

  it('falls back to the accent colour when the badge colour is not a class', () => {
    render(<ListingPromoBanner offer={{ ...OFFER, badge_color: '#ff0000' }} />)
    expect(screen.getByText('Diwali').className).toContain('bg-accent-500')
  })

  it('renders nothing without an image', () => {
    const { container } = render(<ListingPromoBanner offer={{ ...OFFER, image_url: null }} />)
    expect(container.innerHTML).toBe('')
  })
})
