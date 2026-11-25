import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
vi.mock('@/components/visitor/slides/Slides', () => ({
  default: ({ layout, ariaLabel, autoplay, children }: any) => (
    <div data-testid="slides" data-layout={layout} data-autoplay={autoplay} aria-label={ariaLabel}>
      {children}
    </div>
  ),
  useSlide: () => ({ current: true }),
}))
vi.mock('@/components/visitor/slides/SlideImage', () => ({
  default: ({ src, mobileSrc, blurhash }: any) => <i data-testid="slide-image" data-src={src} data-mobile={mobileSrc} data-blur={blurhash ?? ''} />,
}))
vi.mock('@/components/visitor/media/StoreMedia', () => ({
  default: ({ image, video, active, children }: any) => (
    <div data-testid="media" data-image={image} data-video={video ?? ''} data-active={String(active)}>
      {children}
    </div>
  ),
}))

import HeroCarousel from '@/components/visitor/HeroCarousel'

describe('HeroCarousel', () => {
  it('renders nothing without slides', () => {
    const { container } = render(<HeroCarousel slides={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('draws a fading, autoplaying "Featured" slider', () => {
    render(<HeroCarousel slides={[{ id: 'a', title: 'Summer Sale', image_url: '/d.jpg' }]} />)
    const s = screen.getByTestId('slides')
    expect(s).toHaveAttribute('data-layout', 'fade')
    expect(s).toHaveAttribute('data-autoplay', '5000')
    expect(s).toHaveAttribute('aria-label', 'Featured')
  })

  it('shows a DB-backed slide: badge, title (first space becomes a line break), subtitle, link and images', () => {
    render(
      <HeroCarousel
        slides={[
          {
            id: 'a', title: 'Summer Sale', subtitle: 'Up to 50% off', badge_text: 'HOT', badge_color: 'bg-red-500',
            image_url: '/d.jpg', image_url_mobile: '/m.jpg', blurhash: 'DESK', blurhash_mobile: 'MOB', video_url: '/v.mp4', href: '/sale',
          },
        ]}
      />
    )
    expect(screen.getByRole('link', { name: 'Shop Summer Sale' })).toHaveAttribute('href', '/sale')
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1.textContent).toBe('Summer\nSale')
    expect(screen.getByText('HOT')).toHaveClass('bg-red-500')
    expect(screen.getByText('Up to 50% off')).toBeInTheDocument()
    const img = screen.getByTestId('slide-image')
    expect(img).toHaveAttribute('data-src', '/d.jpg')
    expect(img).toHaveAttribute('data-mobile', '/m.jpg')
    expect(img).toHaveAttribute('data-blur', 'MOB')
    expect(screen.getByTestId('media')).toHaveAttribute('data-video', '/v.mp4')
    expect(screen.getByTestId('media')).toHaveAttribute('data-active', 'true')
  })

  it('falls back to the legacy category copy and link for a slide with only a category slug', () => {
    render(<HeroCarousel slides={[{ name: 'Fasteners', slug: 'fasteners', hero_image_desktop: '/hd.jpg', hero_image_mobile: '/hm.jpg' }]} />)
    expect(screen.getByRole('link', { name: 'Shop Fasteners' })).toHaveAttribute('href', '/categories/fasteners')
    expect(screen.getByText('New Arrivals')).toHaveClass('bg-primary-500')
    expect(screen.getByText(/Bolts, nuts, screws/)).toBeInTheDocument()
    const img = screen.getByTestId('slide-image')
    expect(img).toHaveAttribute('data-src', '/hd.jpg')
    expect(img).toHaveAttribute('data-mobile', '/hm.jpg')
  })

  it('defaults an anonymous slide to "Shop Now", the products page and a placeholder image', () => {
    render(<HeroCarousel slides={[{}]} />)
    expect(screen.getByRole('link', { name: 'Shop Shop Now' })).toHaveAttribute('href', '/products')
    expect(screen.getAllByText('Shop Now').length).toBeGreaterThan(0)
    expect(screen.getByTestId('slide-image').getAttribute('data-src')).toMatch(/^data:image\/svg\+xml/)
  })

  it('draws every slide, keyed by id, slug or position', () => {
    render(<HeroCarousel slides={[{ id: 'a', title: 'One' }, { slug: 'abrasives', name: 'Two' }, { title: 'Three' }]} />)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(3)
    expect(screen.getByText('Top Picks')).toBeInTheDocument()
  })

  it('uses the mobile image for desktop when no desktop image exists', () => {
    render(<HeroCarousel slides={[{ title: 'X', image_url_mobile: '/only-m.jpg' }]} />)
    const img = screen.getByTestId('slide-image')
    expect(img).toHaveAttribute('data-src', '/only-m.jpg')
    expect(img).toHaveAttribute('data-mobile', '/only-m.jpg')
  })
})
