import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SECTIONS,
  SECTION_META,
  SECTION_TYPES,
  isWithinWindow,
  productRowKey,
  productSource,
  sectionLayout,
  sectionLimit,
  visibleSections,
  withDefaults,
  type HomepageSection,
} from '@/lib/homepage-sections'

const make = (over: Partial<HomepageSection> = {}): HomepageSection => ({
  id: 'x',
  type: 'product_row',
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

describe('defaults', () => {
  it('starts a store on the classic layout plus the engagement sections that need no setup', () => {
    expect(DEFAULT_SECTIONS.map(s => s.type)).toEqual([
      'hero',
      'trust_strip',
      'category_grid',
      'product_row',
      'brand_carousel',
      'product_row',
      'category_showcase',
      'featured_for_you',
      'recently_viewed',
      'product_row',
      'category_tabs',
      'back_in_stock',
      'testimonials',
      'benefits',
      'why_us',
      'value_stats',
      'about',
      'business_cta',
    ])
  })

  it('leaves out sections that need content before they can show anything', () => {
    const types = DEFAULT_SECTIONS.map(s => s.type)
    for (const t of ['countdown_deal', 'blog_teaser', 'social_strip', 'bundle_spotlight', 'promo_banner'] as const) {
      expect(types).not.toContain(t)
    }
  })

  it('badges recently launched products on the default New Arrivals row', () => {
    const newArrivals = DEFAULT_SECTIONS.find(s => s.config.source === 'new_arrivals')
    expect(newArrivals?.config.justLanded).toBe(true)
  })

  it('assigns a contiguous display order', () => {
    expect(DEFAULT_SECTIONS.map(s => s.display_order)).toEqual([...DEFAULT_SECTIONS.keys()])
  })

  it('falls back to defaults when no rows are configured', () => {
    const out = withDefaults([])
    expect(out).toHaveLength(DEFAULT_SECTIONS.length)
    expect(out.every(s => s.is_active)).toBe(true)
  })

  it('uses configured rows when present', () => {
    const rows = [make({ id: 'real', type: 'hero' })]
    expect(withDefaults(rows)).toBe(rows)
  })

  it('has metadata for every type', () => {
    for (const t of SECTION_TYPES) expect(SECTION_META[t]).toBeDefined()
  })

  it('covers the three product sources the current page hardcodes', () => {
    const sources = DEFAULT_SECTIONS.filter(s => s.type === 'product_row').map(s => s.config.source)
    expect(sources).toEqual(['featured', 'new_arrivals', 'best_sellers'])
  })
})

describe('scheduling window', () => {
  const now = Date.parse('2026-11-01T00:00:00Z')

  it('shows a section with no window', () => {
    expect(isWithinWindow(make(), now)).toBe(true)
  })

  it('hides a section before it starts', () => {
    expect(isWithinWindow(make({ starts_at: '2026-12-01T00:00:00Z' }), now)).toBe(false)
  })

  it('hides a section after it ends', () => {
    expect(isWithinWindow(make({ ends_at: '2026-10-01T00:00:00Z' }), now)).toBe(false)
  })

  it('shows a seasonal banner inside its window', () => {
    const diwali = make({ starts_at: '2026-10-20T00:00:00Z', ends_at: '2026-11-10T00:00:00Z' })
    expect(isWithinWindow(diwali, now)).toBe(true)
  })
})

describe('visibleSections', () => {
  it('drops inactive sections and sorts by display order', () => {
    const out = visibleSections([
      make({ id: 'c', display_order: 2 }),
      make({ id: 'a', display_order: 0 }),
      make({ id: 'off', display_order: 1, is_active: false }),
    ])
    expect(out.map(s => s.id)).toEqual(['a', 'c'])
  })
})

describe('config accessors', () => {
  it('defaults layout to grid so rollout changes nothing visually', () => {
    expect(sectionLayout(make())).toBe('grid')
    expect(sectionLayout(make({ config: { layout: 'carousel' } }))).toBe('carousel')
  })

  it('falls back to a per-type limit', () => {
    expect(sectionLimit(make({ type: 'category_grid' }))).toBe(8)
    expect(sectionLimit(make({ type: 'category_showcase' }))).toBe(4)
  })

  it('honours an explicit limit, including a numeric string', () => {
    expect(sectionLimit(make({ config: { limit: 12 } }))).toBe(12)
    expect(sectionLimit(make({ config: { limit: '6' } }))).toBe(6)
  })

  it('ignores a nonsense limit', () => {
    expect(sectionLimit(make({ type: 'category_grid', config: { limit: 0 } }))).toBe(8)
    expect(sectionLimit(make({ type: 'category_grid', config: { limit: 'abc' } }))).toBe(8)
  })

  it('defaults an unknown product source to featured', () => {
    expect(productSource(make())).toBe('featured')
    expect(productSource(make({ config: { source: 'nope' } }))).toBe('featured')
    expect(productSource(make({ config: { source: 'best_sellers' } }))).toBe('best_sellers')
  })

  it('de-dupes identical product rows via the cache key', () => {
    const a = make({ config: { source: 'featured' } })
    const b = make({ id: 'other', config: { source: 'featured' } })
    expect(productRowKey(a, 8)).toBe(productRowKey(b, 8))
  })

  it('separates rows that differ by source, limit or category', () => {
    const base = make({ config: { source: 'featured' } })
    expect(productRowKey(base, 8)).not.toBe(productRowKey(base, 4))
    expect(productRowKey(base, 8)).not.toBe(productRowKey(make({ config: { source: 'on_sale' } }), 8))
    expect(productRowKey(base, 8)).not.toBe(
      productRowKey(make({ config: { source: 'featured', categorySlug: 'tools' } }), 8)
    )
  })
})
