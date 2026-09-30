import { describe, it, expect } from 'vitest'
import {
  SECTION_META,
  SECTION_TYPES,
  SECTION_COPY_DEFAULTS,
  configId,
  configIds,
  configNumber,
  friendlyCount,
  justLandedDays,
  launchedWithin,
  safeHref,
  valueStatMetrics,
  type HomepageSection,
} from '@/lib/homepage-sections'

const cfg = (config: Record<string, unknown>) => ({ config }) as Pick<HomepageSection, 'config'>
const ID = '11111111-2222-3333-4444-555555555555'

describe('new section types', () => {
  it('registers each with metadata and default heading copy', () => {
    for (const t of [
      'countdown_deal',
      'testimonials',
      'recently_viewed',
      'category_tabs',
      'bundle_spotlight',
      'back_in_stock',
      'blog_teaser',
      'social_strip',
      'value_stats',
    ] as const) {
      expect(SECTION_TYPES).toContain(t)
      expect(SECTION_META[t].label).toBeTruthy()
      expect(SECTION_COPY_DEFAULTS[t].title).toBeTruthy()
    }
  })

  it('keeps the database CHECK in step with the section types', async () => {
    const { readFileSync } = await import('fs')
    const sql = readFileSync('database/catalog.sql', 'utf8')
    const check = sql.slice(sql.indexOf('homepage_sections_type_check'), sql.indexOf('homepage_sections_window_check'))
    for (const t of SECTION_TYPES) expect(check).toContain(`'${t}'::text`)
  })
})

describe('config readers', () => {
  it('reads a positive capped number, else the fallback', () => {
    expect(configNumber(cfg({ tabs: 6 }), 'tabs', 4, 8)).toBe(6)
    expect(configNumber(cfg({ tabs: '20' }), 'tabs', 4, 8)).toBe(8)
    expect(configNumber(cfg({ tabs: 0 }), 'tabs', 4, 8)).toBe(4)
    expect(configNumber(cfg({ tabs: 'x' }), 'tabs', 4, 8)).toBe(4)
  })

  it('keeps only well-formed ids', () => {
    expect(configIds(cfg({ productIds: [ID, 'nope', 7, null] }), 'productIds')).toEqual([ID])
    expect(configIds(cfg({ productIds: 'not-an-array' }), 'productIds')).toEqual([])
    expect(configId(cfg({ productId: ID }), 'productId')).toBe(ID)
    expect(configId(cfg({ productId: 'x' }), 'productId')).toBeNull()
  })
})

describe('safeHref', () => {
  it('allows site paths and http(s) links only', () => {
    expect(safeHref('/products?x=1')).toBe('/products?x=1')
    expect(safeHref('https://instagram.com/p/1')).toBe('https://instagram.com/p/1')
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('//evil.example')).toBeNull()
    expect(safeHref('/\\evil.example')).toBeNull()
    expect(safeHref('')).toBeNull()
    expect(safeHref(null)).toBeNull()
  })
})

describe('Just Landed', () => {
  const now = Date.parse('2026-09-25T00:00:00Z')

  it('is off unless enabled, and defaults to 30 days', () => {
    expect(justLandedDays(cfg({}))).toBeNull()
    expect(justLandedDays(cfg({ justLanded: true }))).toBe(30)
    expect(justLandedDays(cfg({ justLanded: true, newWithinDays: 7 }))).toBe(7)
  })

  it('prefers the launch date, falls back to the date added, and ignores future launches', () => {
    expect(launchedWithin({ launch_date: '2026-09-20', created_at: '2024-01-01' }, 30, now)).toBe(true)
    expect(launchedWithin({ launch_date: null, created_at: '2026-09-01T00:00:00Z' }, 30, now)).toBe(true)
    expect(launchedWithin({ launch_date: '2026-06-01' }, 30, now)).toBe(false)
    expect(launchedWithin({ launch_date: '2026-10-10' }, 30, now)).toBe(false)
    expect(launchedWithin({}, 30, now)).toBe(false)
  })
})

describe('store stats', () => {
  it('defaults to orders, products and cities', () => {
    expect(valueStatMetrics(cfg({})).map(m => m.metric)).toEqual(['orders_shipped', 'products', 'cities'])
  })

  it('keeps catalogue order, custom labels, and drops unknown metrics', () => {
    const picked = valueStatMetrics(
      cfg({
        metrics: [
          { metric: 'customers', label: 'Buyers' },
          { metric: 'orders_shipped', label: '' },
          { metric: 'bogus' },
        ],
      })
    )
    expect(picked).toEqual([
      { metric: 'orders_shipped', label: 'Orders shipped' },
      { metric: 'customers', label: 'Buyers' },
    ])
    expect(valueStatMetrics(cfg({ metrics: [] }))).toEqual([])
  })

  it('rounds large counts down so the plus stays true', () => {
    expect(friendlyCount(47)).toBe('47')
    expect(friendlyCount(213)).toBe('210+')
    expect(friendlyCount(1234)).toBe('1,200+')
  })
})
