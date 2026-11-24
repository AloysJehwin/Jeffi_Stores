import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => <a href={typeof href === 'string' ? href : '#'} {...rest}>{children}</a>,
}))
vi.mock('@/components/visitor/slides/SlideImage', () => ({
  default: ({ src, mobileSrc }: any) => <img data-testid="slide-image" src={src} data-mobile={mobileSrc} alt="" />,
}))
vi.mock('@/components/visitor/media/StoreMedia', () => ({
  default: ({ children, video }: any) => <div data-testid="media" data-video={video}>{children}</div>,
}))
vi.mock('@/components/visitor/slides/PromoCard', () => ({
  bannerShape: (aspect: number) => ({ aspectRatio: aspect }),
}))

import PromoBanner from '@/components/visitor/home/PromoBanner'

describe('PromoBanner', () => {
  it('renders copy, picture and a banner-wide CTA link', () => {
    render(
      <PromoBanner title="Big sale" subtitle="Up to 50% off" eyebrow="Festive" imageUrl="/d.jpg" imageUrlMobile="/m.jpg" ctaLabel="Shop now" ctaUrl="/sale" />,
    )
    expect(screen.getByRole('heading', { name: 'Big sale' })).toBeInTheDocument()
    expect(screen.getByText('Up to 50% off')).toBeInTheDocument()
    expect(screen.getByText('Festive')).toBeInTheDocument()
    const image = screen.getByTestId('slide-image')
    expect(image).toHaveAttribute('src', '/d.jpg')
    expect(image).toHaveAttribute('data-mobile', '/m.jpg')
    expect(screen.getByRole('link', { name: 'Shop now' })).toHaveAttribute('href', '/sale')
  })

  it('falls back to the other image and passes the clip through', () => {
    render(<PromoBanner title="Hi" imageUrlMobile="/only-mobile.jpg" video="/clip.mp4" />)
    expect(screen.getByTestId('slide-image')).toHaveAttribute('src', '/only-mobile.jpg')
    expect(screen.getByTestId('media')).toHaveAttribute('data-video', '/clip.mp4')
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('uses a gradient instead of a picture when there is none, and no link without both label and url', () => {
    const { container } = render(<PromoBanner title="Text only" ctaLabel="Go" />)
    expect(screen.queryByTestId('slide-image')).toBeNull()
    expect(container.querySelector('.from-primary-600')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('applies the banner shape when an aspect is set', () => {
    const { container } = render(<PromoBanner title="Shaped" aspect={2} imageUrl="/a.jpg" />)
    expect(container.querySelector('.shape-box')).toHaveStyle({ aspectRatio: '2' })
  })

  it('renders nothing when there is no content', () => {
    const { container } = render(<PromoBanner />)
    expect(container).toBeEmptyDOMElement()
  })
})
