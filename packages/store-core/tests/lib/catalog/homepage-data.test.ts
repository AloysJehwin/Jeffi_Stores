import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  queryMany: vi.fn(),
}))

// Control the homepage-sections helpers so we test homepage-data's own logic.
vi.mock('@/lib/catalog/homepage-sections', () => ({
  forSurface: vi.fn((rows: any[], surface: string) => rows.filter(r => (r.surface ?? 'web') === surface)),
  rowAudience: vi.fn((r: any) => r.audience ?? 'store'),
  rowPage: vi.fn((r: any) => r.page ?? 'home'),
  productRowKey: vi.fn((s: any, limit: number) => `${s.config?.source ?? 'featured'}:${limit}:${s.config?.categorySlug ?? ''}`),
  productSource: vi.fn((s: any) => s.config?.source ?? 'featured'),
  sectionLimit: vi.fn((s: any, fb: number) => s.config?.limit ?? fb),
  visibleSections: vi.fn((rows: any[]) => rows.filter(r => r.is_active !== false)),
  withDefaults: vi.fn((rows: any[]) => (rows.length ? rows : [{ id: 'builtin', type: 'hero', is_active: true }])),
}))

import {
  SURFACE_COLUMN_SQL,
  PAGE_COLUMN_SQL,
  AUDIENCE_COLUMN_SQL,
  getConfiguredSections,
  getAudienceSections,
  buildProductRowSql,
  buildProductCardSql,
  planProductRows,
  planDataNeeds,
} from '@/lib/catalog/homepage-data'
import { queryMany } from '@/lib/shared/db'

const deps = { minPriceSql: 'MIN', variantStockTotalSql: 'STK', variantMinMrpSql: 'MRP', totalSoldSql: 'SOLD' }

describe('column SQL helpers', () => {
  it('read surface/page/audience via to_jsonb', () => {
    expect(SURFACE_COLUMN_SQL('s')).toBe("to_jsonb(s) ->> 'surface' AS surface")
    expect(PAGE_COLUMN_SQL('s')).toBe("to_jsonb(s) ->> 'page' AS page")
    expect(AUDIENCE_COLUMN_SQL('s')).toBe("to_jsonb(s) ->> 'audience' AS audience")
  })
})

describe('getAudienceSections', () => {
  beforeEach(() => vi.mocked(queryMany).mockReset())

  it('returns store sections filtered by page, surface and visibility', async () => {
    vi.mocked(queryMany).mockResolvedValue([
      { id: '1', page: 'home', audience: 'store', surface: 'web', is_active: true },
      { id: '2', page: 'products', audience: 'store', surface: 'web', is_active: true }, // wrong page
      { id: '3', page: 'home', audience: 'store', surface: 'web', is_active: false }, // hidden
    ] as any)
    const out = await getAudienceSections('web', 'home', 'store')
    expect(out.audience).toBe('store')
    expect(out.sections.map((s: any) => s.id)).toEqual(['1'])
  })

  it('business homepage with visible business rows returns business audience', async () => {
    vi.mocked(queryMany).mockResolvedValue([
      { id: 'b', page: 'home', audience: 'business', surface: 'web', is_active: true },
    ] as any)
    const out = await getAudienceSections('web', 'home', 'business')
    expect(out.audience).toBe('business')
    expect(out.sections.map((s: any) => s.id)).toEqual(['b'])
  })

  it('business falls back to store sections when business has none visible', async () => {
    vi.mocked(queryMany).mockResolvedValue([
      { id: 's', page: 'home', audience: 'store', surface: 'web', is_active: true },
    ] as any)
    const out = await getAudienceSections('web', 'home', 'business')
    expect(out.audience).toBe('store')
    expect(out.sections.map((s: any) => s.id)).toEqual(['s'])
  })

  it('home with no own rows uses withDefaults (built-in)', async () => {
    vi.mocked(queryMany).mockResolvedValue([] as any)
    const out = await getAudienceSections('web', 'home', 'store')
    expect(out.sections.map((s: any) => s.id)).toEqual(['builtin'])
  })

  it('a listing page does NOT apply withDefaults', async () => {
    vi.mocked(queryMany).mockResolvedValue([] as any)
    const out = await getAudienceSections('web', 'products', 'store')
    expect(out.sections).toEqual([])
  })

  it('accepts preview rows without querying', async () => {
    const out = await getAudienceSections('web', 'home', 'store', [
      { id: 'pv', page: 'home', audience: 'store', surface: 'web', is_active: true } as any,
    ])
    expect(queryMany).not.toHaveBeenCalled()
    expect(out.sections.map((s: any) => s.id)).toEqual(['pv'])
  })

  it('falls back to built-in when the row shape is unusable (catch path)', async () => {
    // A resolved-but-broken result makes rows.filter throw inside the try → caught.
    vi.mocked(queryMany).mockResolvedValue(null as any)
    const out = await getAudienceSections('web', 'home', 'store')
    expect(out.audience).toBe('store')
    expect(out.sections.map((s: any) => s.id)).toEqual(['builtin'])
  })
})

describe('getConfiguredSections', () => {
  it('delegates to getAudienceSections with store audience', async () => {
    vi.mocked(queryMany).mockResolvedValue([
      { id: '1', page: 'home', audience: 'store', surface: 'web', is_active: true },
    ] as any)
    const out = await getConfiguredSections('web', 'home')
    expect(out.map((s: any) => s.id)).toEqual(['1'])
  })
})

describe('buildProductCardSql', () => {
  it('splices the where/orderBy/limit and dependency SQL', () => {
    const sql = buildProductCardSql({ where: 'W', orderBy: 'O', limit: '$1' }, deps)
    expect(sql).toContain('WHERE W')
    expect(sql).toContain('ORDER BY O')
    expect(sql).toContain('LIMIT $1')
    expect(sql).toContain('STK AS variant_stock_total')
    expect(sql).toContain('MIN AS variant_min_price')
    expect(sql).toContain('MRP AS variant_min_mrp')
    expect(sql).toContain('SOLD AS total_sold')
  })
})

describe('buildProductRowSql — source clauses', () => {
  it('new_arrivals', () => {
    expect(buildProductRowSql('new_arrivals', null, deps)).toContain('ORDER BY p.created_at DESC')
  })
  it('best_sellers', () => {
    expect(buildProductRowSql('best_sellers', null, deps)).toContain('ORDER BY total_sold DESC, p.created_at DESC')
  })
  it('on_sale', () => {
    const sql = buildProductRowSql('on_sale', null, deps)
    expect(sql).toContain('p.mrp > p.base_price')
    expect(sql).toContain('ORDER BY (p.mrp - p.base_price) DESC')
  })
  it('category with slug vs without', () => {
    expect(buildProductRowSql('category', 'tools', deps)).toContain('c.slug = $2')
    expect(buildProductRowSql('category', null, deps)).toContain('WHERE p.is_active = true')
  })
  it('featured (default)', () => {
    expect(buildProductRowSql('featured', null, deps)).toContain('p.is_featured = true')
    expect(buildProductRowSql('unknown' as any, null, deps)).toContain('p.is_featured = true')
  })
})

describe('planProductRows', () => {
  it('collects product_row sections, de-duping identical configs', () => {
    const plan = planProductRows([
      { id: 'a', type: 'product_row', config: { source: 'featured', limit: 8 } },
      { id: 'b', type: 'product_row', config: { source: 'featured', limit: 8 } }, // dup key
      { id: 'c', type: 'product_row', config: { source: 'category', limit: 4, categorySlug: 'x' } },
      { id: 'd', type: 'hero', config: {} }, // ignored
    ] as any)
    expect(plan.size).toBe(2)
    expect(plan.get('featured:8:')).toEqual({ source: 'featured', limit: 8, categorySlug: null })
    expect(plan.get('category:4:x')).toEqual({ source: 'category', limit: 4, categorySlug: 'x' })
  })
})

describe('planDataNeeds', () => {
  it('flags needs by section type', () => {
    const needs = planDataNeeds([
      { type: 'hero' },
      { type: 'offer_slider' },
      { type: 'brand_carousel' },
      { type: 'trust_strip' },
    ] as any)
    expect(needs.heroSlides).toBe(true)
    expect(needs.offerSlider).toBe(true)
    expect(needs.topBrands).toBe(true)
    expect(needs.freeShippingThreshold).toBe(true)
    expect(needs.dealOfTheDay).toBe(false)
  })

  it('app home always needs mainCategories', () => {
    expect(planDataNeeds([] as any, 'app', 'home').mainCategories).toBe(true)
    expect(planDataNeeds([] as any, 'web', 'home').mainCategories).toBe(false)
    expect(planDataNeeds([{ type: 'category_grid' }] as any, 'web', 'home').mainCategories).toBe(true)
  })
})
