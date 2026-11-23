import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Block } from '@jeffi/site-blocks'

// next/link -> plain anchor so the Button branch renders in happy-dom.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

// image-url helpers are pure but mocked for a deterministic src/srcset.
vi.mock('@/lib/shared/image-url', () => ({
  responsiveImg: (src: string) => ({ src, srcSet: `${src} 640w` }),
  srcSetFor: (src: string) => `${src} 640w`,
}))

// Server/async-component dependencies are imported at module top; stub them so importing
// ContentBlocks doesn't drag in server code. The sync branches under test never render these.
vi.mock('@/components/visitor/site/ComposedBlock', () => ({ default: () => <div data-testid="composed" /> }))
vi.mock('@/components/visitor/site/code/CodeSection', () => ({ default: () => <div data-testid="code-section" /> }))
vi.mock('@/lib/catalog/site-controls', () => ({
  getStoreIdentity: vi.fn(),
  getStorefrontContent: vi.fn(),
}))
vi.mock('@/lib/catalog/brand', () => ({ storeAddressLine: vi.fn() }))

// eslint-disable-next-line import/first
import { ContentBlock } from '@/components/visitor/site/ContentBlocks'

const block = (type: string, props: Record<string, unknown>): Block =>
  ({ id: 'b1', type, props } as unknown as Block)

describe('ContentBlock (branch routing + render)', () => {
  it('returns null for an unknown block type', () => {
    const { container } = render(<ContentBlock block={block('not_a_block', {})} />)
    expect(container.firstChild).toBeNull()
  })

  describe('rich_text', () => {
    it('renders the heading and splits body on blank lines into paragraphs', () => {
      render(<ContentBlock block={block('rich_text', { heading: 'About us', body: 'First para.\n\nSecond para.' })} />)
      expect(screen.getByRole('heading', { name: 'About us' })).toBeInTheDocument()
      expect(screen.getByText('First para.')).toBeInTheDocument()
      expect(screen.getByText('Second para.')).toBeInTheDocument()
    })

    it('omits the heading when blank', () => {
      render(<ContentBlock block={block('rich_text', { body: 'Body only' })} />)
      expect(screen.queryByRole('heading')).toBeNull()
      expect(screen.getByText('Body only')).toBeInTheDocument()
    })
  })

  describe('image_text', () => {
    it('renders image, heading, body and a CTA link', () => {
      const { container } = render(
        <ContentBlock
          block={block('image_text', {
            image: '/pic.jpg',
            heading: 'Our story',
            body: 'Hello',
            ctaLabel: 'Read more',
            ctaUrl: '/about',
          })}
        />
      )
      const img = container.querySelector('img') as HTMLImageElement
      expect(img.getAttribute('src')).toBe('/pic.jpg')
      expect(screen.getByRole('heading', { name: 'Our story' })).toBeInTheDocument()
      const cta = screen.getByRole('link', { name: 'Read more' })
      expect(cta).toHaveAttribute('href', '/about')
    })

    it('hides the CTA when label or url is missing', () => {
      render(<ContentBlock block={block('image_text', { heading: 'No cta', body: 'x', ctaLabel: 'Go' })} />)
      expect(screen.queryByRole('link')).toBeNull()
    })

    it('marks the image eager when priority is set', () => {
      const { container } = render(
        <ContentBlock block={block('image_text', { image: '/pic.jpg', body: 'x' })} priority />
      )
      expect((container.querySelector('img') as HTMLImageElement).getAttribute('loading')).toBe('eager')
    })
  })

  describe('image_banner', () => {
    it('renders heading, subheading and a light CTA by default (dark overlay)', () => {
      render(
        <ContentBlock
          block={block('image_banner', {
            image: '/banner.jpg',
            heading: 'Big sale',
            subheading: 'Up to 50% off',
            ctaLabel: 'Shop',
            ctaUrl: '/shop',
          })}
        />
      )
      expect(screen.getByRole('heading', { name: 'Big sale' })).toBeInTheDocument()
      expect(screen.getByText('Up to 50% off')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Shop' })).toHaveAttribute('href', '/shop')
    })

    it('emits a <source> for the mobile image when provided', () => {
      const { container } = render(
        <ContentBlock block={block('image_banner', { image: '/d.jpg', mobileImage: '/m.jpg', heading: 'H' })} />
      )
      const source = container.querySelector('picture source')
      expect(source).toBeInTheDocument()
      expect(source?.getAttribute('data-raw')).toBe('/m.jpg')
    })
  })

  describe('faq', () => {
    it('renders each question/answer as a <details> item', () => {
      render(
        <ContentBlock
          block={block('faq', {
            heading: 'Questions',
            items: [
              { q: 'Shipping?', a: 'Two days.' },
              { q: 'Returns?', a: 'Thirty days.' },
            ],
          })}
        />
      )
      expect(screen.getByRole('heading', { name: 'Questions' })).toBeInTheDocument()
      expect(screen.getByText('Shipping?')).toBeInTheDocument()
      expect(screen.getByText('Returns?')).toBeInTheDocument()
      expect(screen.getByText('Two days.')).toBeInTheDocument()
    })

    it('renders no items when items is absent', () => {
      const { container } = render(<ContentBlock block={block('faq', { heading: 'Empty' })} />)
      expect(container.querySelectorAll('details').length).toBe(0)
    })
  })
})
