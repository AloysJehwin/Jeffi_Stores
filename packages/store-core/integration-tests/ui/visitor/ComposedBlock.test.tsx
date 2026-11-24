import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
vi.mock('@/components/visitor/ProductCard', () => ({ default: (p: any) => <div data-testid="card">{`${p.name}|aspect:${p.imageAspect}`}</div> }))
vi.mock('@/components/visitor/SectionCarousel', () => ({
  default: ({ ariaLabel, children }: any) => <div data-testid="carousel" aria-label={ariaLabel}>{children}</div>,
}))
vi.mock('@/components/visitor/home/Reveal', () => ({ default: ({ children }: any) => <div data-testid="reveal">{children}</div> }))
vi.mock('@/lib/catalog/product-card-props', () => ({ productCardProps: (p: any, gst: boolean) => ({ id: p.id, name: `${p.name}${gst ? '+gst' : ''}` }) }))
const getFeatureFlags = vi.fn()
vi.mock('@/lib/catalog/site-controls', () => ({ getFeatureFlags: () => getFeatureFlags() }))
const loadComposedData = vi.fn()
vi.mock('@/lib/site/composed-data', () => ({ loadComposedData: (...a: any[]) => loadComposedData(...a) }))
vi.mock('@/components/visitor/site/ComposedCountdown', () => ({ default: ({ label }: any) => <div data-testid="countdown">{label}</div> }))
vi.mock('@/lib/catalog/product-offers-shared', () => ({ offerHref: (s: string) => `/offers/${s}` }))

import ComposedBlock from '@/components/visitor/site/ComposedBlock'

const section = (children: any[], over: Record<string, any> = {}) => ({ kind: 'section', tone: 'default', padding: 'md', width: 'normal', fx: 'none', children, ...over })
const draw = async (props: any, extra: Record<string, any> = {}) => {
  const ui = await ComposedBlock({ props, ...extra })
  return render(<>{ui}</>)
}

describe('ComposedBlock', () => {
  beforeEach(() => {
    getFeatureFlags.mockReset()
    getFeatureFlags.mockResolvedValue({ gstEnabled: false })
    loadComposedData.mockReset()
    loadComposedData.mockResolvedValue({})
  })

  it('draws nothing for an empty or invalid tree', async () => {
    expect(((await draw({ tree: null })).container as HTMLElement)).toBeEmptyDOMElement()
    expect(((await draw({ tree: { kind: 'bogus' } })).container as HTMLElement)).toBeEmptyDOMElement()
    expect(loadComposedData).not.toHaveBeenCalled()
  })

  it('draws content nodes: heading level, text paragraphs, button link, badge, spacer and divider', async () => {
    await draw({
      tree: section([
        { kind: 'heading', level: 2, text: 'Big news', tone: 'default', align: 'left' },
        { kind: 'text', text: 'First para\n\nSecond para', size: 'md', tone: 'default', align: 'left' },
        { kind: 'button', label: 'Shop now', href: '/products', variant: 'solid' },
        { kind: 'badge', text: 'NEW', tone: 'brand' },
        { kind: 'spacer', size: 'md' },
        { kind: 'divider' },
      ]),
    })
    expect(screen.getByRole('heading', { level: 2, name: 'Big news' })).toBeInTheDocument()
    expect(screen.getByText('First para')).toBeInTheDocument()
    expect(screen.getByText('Second para')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Shop now' })).toHaveAttribute('href', '/products')
    expect(screen.getByText('NEW')).toBeInTheDocument()
    expect(screen.getByRole('separator')).toBeInTheDocument()
  })

  it('wraps a fading section in Reveal and not a plain one', async () => {
    const a = await draw({ tree: section([{ kind: 'divider' }], { fx: 'fade' }) })
    expect(screen.getByTestId('reveal')).toBeInTheDocument()
    a.unmount()
    await draw({ tree: section([{ kind: 'divider' }]) })
    expect(screen.queryByTestId('reveal')).not.toBeInTheDocument()
  })

  it('an image links when it has an href, shows hover art, and the first one claims the LCP slot', async () => {
    const { container } = await draw(
      { tree: section([{ kind: 'image', src: 'https://img.test/a.jpg', alt: 'Hero', radius: 'md', href: '/sale', hoverSrc: 'https://img.test/b.jpg' }, { kind: 'image', src: 'https://img.test/c.jpg', alt: 'Second', radius: 'md' }]) },
      { priority: true }
    )
    expect(screen.getByAltText('Hero').closest('a')).toHaveAttribute('href', '/sale')
    expect(screen.getByAltText('Hero')).toHaveAttribute('loading', 'eager')
    expect(screen.getByAltText('Second')).toHaveAttribute('loading', 'lazy')
    expect(container.querySelector('img[aria-hidden]')).not.toBeNull()
  })

  it('without priority every picture is lazy', async () => {
    await draw({ tree: section([{ kind: 'image', src: 'https://img.test/a.jpg', alt: 'Hero', radius: 'md' }]) })
    expect(screen.getByAltText('Hero')).toHaveAttribute('loading', 'lazy')
  })

  it('products from the loaded data become cards, GST-aware, and nothing when there are none', async () => {
    getFeatureFlags.mockResolvedValue({ gstEnabled: true })
    const tree = section([{ kind: 'products', query: {}, layout: 'grid', cols: { web: 4, web_mobile: 2 }, aspect: { web: '4:5', web_mobile: '4:5' } }])
    await draw({ tree }, { data: { '0.0': [{ id: 'p1', name: 'Speaker' }, { id: 'p2', name: 'Cable' }] } })
    expect(screen.getAllByTestId('card').map(c => c.textContent)).toEqual(['Speaker+gst|aspect:0.8', 'Cable+gst|aspect:0.8'])
    document.body.innerHTML = ''
    await draw({ tree }, { data: { '0.0': [] } })
    expect(screen.queryByTestId('card')).not.toBeInTheDocument()
  })

  it('loads the data itself when none is passed', async () => {
    loadComposedData.mockResolvedValue({ '0.0': [{ id: 'p1', name: 'Speaker' }] })
    await draw({ tree: section([{ kind: 'products', query: {}, layout: 'grid', cols: { web: 4, web_mobile: 2 } }]) })
    expect(loadComposedData).toHaveBeenCalledWith(expect.objectContaining({ kind: 'section' }), false)
    expect(screen.getByTestId('card')).toBeInTheDocument()
  })

  it('a carousel layout hands the items to the carousel', async () => {
    await draw({ tree: section([{ kind: 'categories', query: {}, layout: 'carousel', cols: { web: 4, web_mobile: 2 } }]) }, { data: { '0.0': [{ id: 'c1', slug: 'audio', name: 'Audio', image_url: '/a.jpg' }] } })
    expect(screen.getByTestId('carousel')).toHaveAttribute('aria-label', 'Categories')
    expect(screen.getByRole('link', { name: /Audio/ })).toHaveAttribute('href', '/categories/audio')
  })

  it('brands show a logo or fall back to the name', async () => {
    await draw({ tree: section([{ kind: 'brands', query: {}, layout: 'grid' }]) }, { data: { '0.0': [{ id: 'b1', slug: 'halo', name: 'Halo', logo_url: '/h.png' }, { id: 'b2', slug: 'zed', name: 'Zed', logo_url: null }] } })
    expect(screen.getByAltText('Halo').closest('a')).toHaveAttribute('href', '/brands/halo')
    expect(screen.getByText('Zed').closest('a')).toHaveAttribute('href', '/brands/zed')
  })

  it('reviews show stars, a trimmed quote and the product link', async () => {
    const long = 'x'.repeat(300)
    await draw({ tree: section([{ kind: 'review', query: {}, layout: 'grid' }]) }, { data: { '0.0': [{ id: 'r1', rating: 4, comment: long, author: 'Asha', productSlug: 'halo', productName: 'Halo Speaker' }] } })
    expect(screen.getByLabelText('4 out of 5')).toBeInTheDocument()
    expect(screen.getByText(/x{277}…/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Halo Speaker' })).toHaveAttribute('href', '/products/halo')
  })

  it('offers show title, subtitle and badge and link to the offer page', async () => {
    await draw({ tree: section([{ kind: 'offers', query: {}, layout: 'grid' }]) }, { data: { '0.0': [{ id: 'o1', slug: 'diwali', title: 'Diwali', subtitle: 'Up to 50%', badge_text: 'HOT', image_url: '/o.jpg', image_url_card: null }] } })
    const link = screen.getByRole('link', { name: /Diwali/ })
    expect(link).toHaveAttribute('href', '/offers/diwali')
    expect(screen.getByText('Up to 50%')).toBeInTheDocument()
    expect(screen.getByText('HOT')).toBeInTheDocument()
  })

  it('a countdown shows only before its end; an ended one is dropped', async () => {
    const future = new Date(Date.now() + 86400000).toISOString()
    const past = new Date(Date.now() - 86400000).toISOString()
    await draw({ tree: section([{ kind: 'countdown', endsAt: future, label: 'Sale ends', align: 'left' }]) })
    expect(screen.getByTestId('countdown')).toHaveTextContent('Sale ends')
    document.body.innerHTML = ''
    await draw({ tree: section([{ kind: 'countdown', endsAt: past, label: 'Ended', align: 'left' }, { kind: 'divider' }]) })
    expect(screen.queryByTestId('countdown')).not.toBeInTheDocument()
  })

  it('a marquee repeats its items for a seamless loop (the copy is hidden from assistive tech) and adds its CSS once', async () => {
    const { container } = await draw({ tree: section([{ kind: 'marquee', items: ['Free shipping', 'COD'], speed: 'fast', tone: 'brand' }]) })
    expect(screen.getAllByText('Free shipping')).toHaveLength(2)
    expect(screen.getAllByText('Free shipping')[1]).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelectorAll('style')).toHaveLength(1)
    expect(container.querySelector('.composed-marquee-track')).toHaveStyle({ animationDuration: '14s' })
  })

  it('layout containers nest their children: columns, stack and grid', async () => {
    await draw({
      tree: section([
        { kind: 'columns', ratio: '1:1', gap: 'md', valign: 'center', children: [{ kind: 'heading', level: 3, text: 'Left', tone: 'default', align: 'left' }, { kind: 'heading', level: 3, text: 'Right', tone: 'default', align: 'left' }] },
        { kind: 'stack', gap: 'md', align: 'center', children: [{ kind: 'badge', text: 'Stacked', tone: 'muted' }] },
        { kind: 'grid', gap: 'md', cols: { web: 2, web_mobile: 1 }, children: [{ kind: 'badge', text: 'Gridded', tone: 'muted' }] },
      ]),
    })
    for (const t of ['Left', 'Right', 'Stacked', 'Gridded']) expect(screen.getByText(t)).toBeInTheDocument()
  })

  it('a carousel container wraps its children in the "Gallery" carousel', async () => {
    await draw({ tree: section([{ kind: 'carousel', children: [{ kind: 'badge', text: 'One', tone: 'muted' }] }]) })
    expect(screen.getByTestId('carousel')).toHaveAttribute('aria-label', 'Gallery')
  })
})
