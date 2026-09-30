import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import SectionRenderer, { type SectionData } from '@/components/visitor/home/SectionRenderer'
import type { HomepageSection, SectionType } from '@/lib/homepage-sections'

afterEach(cleanup)

const data = (extras: [string, unknown][] = []): SectionData => ({
  heroSlides: [],
  mainCategories: [],
  topBrands: [],
  categoryShowcase: [],
  dealOfTheDay: [],
  offers: [],
  productRows: new Map(),
  freeShippingThreshold: 0,
  gstEnabled: false,
  stats: [],
  aboutCopy: '',
  storeName: 'Test',
  businessLandingUrl: '/b',
  businessSignupUrl: '/s',
  extras: new Map(extras),
})

const section = (type: SectionType, over: Partial<HomepageSection> = {}): HomepageSection => ({
  id: 's1',
  type,
  title: null,
  subtitle: null,
  eyebrow: null,
  cta_label: null,
  cta_url: null,
  config: {},
  display_order: 0,
  is_active: true,
  starts_at: null,
  ends_at: null,
  ...over,
})

const draw = (s: HomepageSection, d = data()) => render(<SectionRenderer section={s} data={d} rowIndex={0} />)

describe('new homepage sections', () => {
  it('renders nothing for data-backed sections without data', () => {
    for (const type of [
      'countdown_deal',
      'testimonials',
      'category_tabs',
      'bundle_spotlight',
      'back_in_stock',
      'value_stats',
    ] as const) {
      const { container } = draw(section(type))
      expect(`${type}:${container.innerHTML}`).toBe(`${type}:`)
      cleanup()
    }
  })

  it('shows testimonials with the default heading', () => {
    draw(
      section('testimonials'),
      data([
        [
          's1',
          [
            {
              id: 'r1',
              rating: 5,
              title: null,
              comment: 'Arrived fast and works well',
              author: 'Aloys J.',
              verified: true,
              productName: 'Drill',
              productSlug: 'drill',
            },
          ],
        ],
      ])
    )
    expect(screen.getByText('What our customers say')).toBeTruthy()
    expect(screen.getByText('Aloys J.')).toBeTruthy()
    expect(screen.getByText('Verified purchase')).toBeTruthy()
  })

  it('shows store stats as rounded figures with custom labels', () => {
    draw(
      section('value_stats', { title: 'In numbers' }),
      data([
        [
          's1',
          [
            { metric: 'orders_shipped', label: 'Orders shipped', value: 1234 },
            { metric: 'customers', label: 'Buyers', value: 47 },
          ],
        ],
      ])
    )
    expect(screen.getByText('In numbers')).toBeTruthy()
    expect(screen.getByText('1,200+')).toBeTruthy()
    expect(screen.getByText('47')).toBeTruthy()
    expect(screen.getByText('Buyers')).toBeTruthy()
  })

  it('drops social posts with unsafe or missing links, and hides when none are left', () => {
    draw(
      section('social_strip', {
        config: {
          items: [
            { imageUrl: 'https://cdn/a.jpg', url: 'https://instagram.com/p/1', caption: 'Workshop' },
            { imageUrl: 'https://cdn/b.jpg', url: 'javascript:alert(1)', caption: 'Bad' },
            { imageUrl: '', url: 'https://instagram.com/p/2', caption: 'No image' },
          ],
        },
      })
    )
    const links = screen.getAllByRole('link')
    expect(links.map(a => a.getAttribute('href'))).toEqual(['https://instagram.com/p/1'])
    expect(links[0].getAttribute('target')).toBe('_blank')
    cleanup()
    const { container } = draw(
      section('social_strip', { config: { items: [{ imageUrl: 'x', url: 'javascript:x', caption: '' }] } })
    )
    expect(container.innerHTML).toBe('')
  })

  it('shows only articles with a title and a safe link', () => {
    draw(
      section('blog_teaser', {
        config: {
          items: [
            { title: 'Choosing a drill bit', excerpt: 'A short guide', url: '/guides/drill-bits', imageUrl: '' },
            { title: '', excerpt: 'Untitled', url: '/x', imageUrl: '' },
            { title: 'Bad link', excerpt: '', url: 'javascript:alert(1)', imageUrl: '' },
          ],
        },
      })
    )
    expect(screen.getByText('Choosing a drill bit')).toBeTruthy()
    expect(screen.queryByText('Bad link')).toBeNull()
    expect(screen.queryByText('Untitled')).toBeNull()
  })
})
