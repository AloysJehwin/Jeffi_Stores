import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

let slideState = { current: true, clone: false }
let slidesProps: any
vi.mock('@/components/visitor/slides/Slides', () => ({
  default: (p: any) => {
    slidesProps = p
    return <div data-testid="slides" data-layout={p.layout} aria-label={p.ariaLabel}>{p.children}</div>
  },
  useSlide: () => slideState,
}))
vi.mock('@/components/visitor/slides/SlideImage', () => ({ default: ({ cardSrc, alt }: any) => <img data-testid="slide-image" src={cardSrc} alt={alt} /> }))
vi.mock('@/components/visitor/slides/PromoCard', () => {
  const face = (kind: string) => (p: any) => (
    <a data-kind={kind} href={p.href ?? undefined} aria-label={p.label} data-surface={p.surface ?? ''} tabIndex={p.tabIndex}>
      {p.backdrop}
      {p.badge}
      {p.eyebrow}
      {p.title}
      {p.sub}
      {p.ctaLabel}
      {p.footer}
      {p.action}
    </a>
  )
  return {
    BANNER_IMAGE: 'banner-img',
    CARD_IMAGE: 'card-img',
    PromoBanner: face('banner'),
    PromoCard: face('card'),
    PromoMedia: ({ children, video, card }: any) => <div data-testid="media" data-video={video ?? ''} data-card={String(card)}>{children}</div>,
  }
})
vi.mock('@/components/visitor/QuickAddButton', () => ({ default: ({ productName, discountPct }: any) => <button>{`quick add ${productName} ${discountPct}`}</button> }))

import SlidesSection from '@/components/visitor/home/SlidesSection'

const custom = (id: string, over: Record<string, any> = {}) => ({
  id, kind: 'custom', title: `Slide ${id}`, sub: 'Sub', badge: 'NEW', badgeClass: 'b', eyebrow: 'EYE', ctaLabel: 'Go', href: `/s/${id}`, image: '/wide.jpg', imageCard: '/card.jpg',
  blurhash: null, blurhashCard: null, video: null, videoCard: null, motion: 'none', ...over,
})
const product = (id: string, over: Record<string, any> = {}) => ({
  id, kind: 'product', title: `Prod ${id}`, href: `/products/${id}`, image: null, imageCard: '/p.jpg', price: 1000, mrp: 1500,
  product: { id, name: `Prod ${id}`, slug: id, hasVariants: false, isDigital: false, effectiveStock: 5, primaryImage: null, brandName: null, categoryName: null, displayPrice: 1000, mrp: 1500, discountPct: 0, mrpDiscount: 33 }, ...over,
})
const data = (slides: any[], over: Record<string, any> = {}) => ({ layout: 'cards', aspect: '4:5', autoplay: false, intervalSeconds: 5, slides, ...over }) as any

describe('SlidesSection', () => {
  beforeEach(() => {
    slideState = { current: true, clone: false }
    slidesProps = undefined
  })

  it('renders nothing without slides', () => {
    const { container } = render(<SlidesSection data={data([])} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the eyebrow and title heading, and labels the slider with the title or "Slides"', () => {
    const a = render(<SlidesSection data={data([custom('1')])} eyebrow="New in" title="Featured" />)
    expect(screen.getByRole('heading', { name: 'Featured' })).toBeInTheDocument()
    expect(screen.getByText('New in')).toBeInTheDocument()
    expect(screen.getByTestId('slides')).toHaveAttribute('aria-label', 'Featured')
    a.unmount()
    render(<SlidesSection data={data([custom('1')])} />)
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.getByTestId('slides')).toHaveAttribute('aria-label', 'Slides')
  })

  it('a custom slide shows its copy, link and card image', () => {
    render(<SlidesSection data={data([custom('1')])} />)
    const link = screen.getByRole('link', { name: 'Slide 1, NEW, Sub' })
    expect(link).toHaveAttribute('href', '/s/1')
    expect(link).toHaveAttribute('data-kind', 'card')
    expect(link.textContent).toContain('EYE')
    expect(link.textContent).toContain('NEW')
    expect(link.textContent).toContain('Go')
    expect(screen.getByTestId('slide-image')).toHaveAttribute('src', '/card.jpg')
  })

  it('a slide without an image gets the gradient surface', () => {
    render(<SlidesSection data={data([custom('1', { image: null, imageCard: null })])} />)
    expect(screen.getByRole('link')).toHaveAttribute('data-surface', expect.stringContaining('from-primary-600'))
    expect(screen.queryByTestId('slide-image')).not.toBeInTheDocument()
  })

  it('autoplay passes the interval in ms, or false when off', () => {
    const a = render(<SlidesSection data={data([custom('1')], { autoplay: true, intervalSeconds: 4 })} />)
    expect(slidesProps.autoplay).toBe(4000)
    a.unmount()
    render(<SlidesSection data={data([custom('1')])} />)
    expect(slidesProps.autoplay).toBe(false)
  })

  it.each([
    ['cards', '4:5', (p: any) => expect(p.aspect).toBe('4:5')],
    ['cards', '16:9', (p: any) => expect(p.cardWidth).toContain('--slide-w')],
    ['rail', '1:1', (p: any) => expect(p.slideClassName).toBe('aspect-square')],
    ['rail', '16:9', (p: any) => expect(p.itemClassName).toContain('w-[80%]')],
    ['fade', '1:1', (p: any) => expect(p.className).toContain('max-w-md')],
    ['banner', '4:5', (p: any) => expect(p.dots.className).toContain('justify-center')],
  ])('%s layout at %s passes its sizing to the slider', (layout, aspect, check) => {
    render(<SlidesSection data={data([custom('1'), custom('2')], { layout, aspect })} />)
    expect(screen.getByTestId('slides')).toHaveAttribute('data-layout', layout)
    check(slidesProps)
  })

  it('fade gives a multi-slide stage room for its dots, a single one not', () => {
    const a = render(<SlidesSection data={data([custom('1'), custom('2')], { layout: 'fade' })} />)
    expect(slidesProps.className).toContain('mb-9')
    expect(slidesProps.arrows).toBe(true)
    a.unmount()
    render(<SlidesSection data={data([custom('1')], { layout: 'fade' })} />)
    expect(slidesProps.className).not.toContain('mb-9')
  })

  it('banner layout draws wide banners', () => {
    render(<SlidesSection data={data([custom('1')], { layout: 'banner' })} />)
    expect(screen.getByRole('link')).toHaveAttribute('data-kind', 'banner')
  })

  it('a product slide shows its price, strike-through MRP, "From" for variants, and a quick-add', () => {
    const p = product('a', { product: { ...product('a').product, hasVariants: true } })
    render(<SlidesSection data={data([p])} />)
    expect(screen.getByRole('link', { name: /From ₹1,000/ })).toBeInTheDocument()
    expect(screen.getByText(/₹1,500/)).toHaveClass('line-through')
    expect(screen.getByRole('button', { name: 'quick add Prod a 33' })).toBeInTheDocument()
  })

  it('the admin preview drops links and quick-add', () => {
    render(<SlidesSection data={data([product('a')])} preview />)
    expect(screen.getByLabelText(/Prod a/)).not.toHaveAttribute('href')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('no MRP strike-through when MRP is not above the price', () => {
    render(<SlidesSection data={data([product('a', { mrp: 1000 })])} />)
    expect(screen.queryByText(/line-through/)).not.toBeInTheDocument()
    expect(document.querySelector('.line-through')).toBeNull()
  })

  it('clone slides are taken out of the tab order', () => {
    slideState = { current: false, clone: true }
    render(<SlidesSection data={data([custom('1')])} />)
    expect(screen.getByRole('link')).toHaveAttribute('tabindex', '-1')
  })

  it('motion effects wrap the picture: kenburns zoom, parallax drift, reveal headline', () => {
    const k = render(<SlidesSection data={data([custom('1', { motion: 'kenburns' })])} />)
    expect(screen.getByTestId('slide-image')).toBeInTheDocument()
    k.unmount()
    const p = render(<SlidesSection data={data([custom('1', { motion: 'parallax' })])} />)
    expect(screen.getByTestId('slide-image')).toBeInTheDocument()
    p.unmount()
    render(<SlidesSection data={data([custom('1', { motion: 'reveal' })])} />)
    expect(screen.getByText('Slide')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })
})
