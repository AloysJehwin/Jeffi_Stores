import { describe, it, expect } from 'vitest'
import { buildProductRowSql, planDataNeeds, planProductRows, type ProductRowQueryDeps } from '@/lib/homepage-data'
import { DEFAULT_SECTIONS, type HomepageSection } from '@/lib/homepage-sections'

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

const defaults: HomepageSection[] = DEFAULT_SECTIONS.map((s, i) => ({
  ...s,
  id: `d${i}`,
  is_active: true,
  starts_at: null,
  ends_at: null,
}))

const deps: ProductRowQueryDeps = {
  minPriceSql: 'MINPRICE',
  variantStockTotalSql: 'STOCK',
  variantMinMrpSql: 'MRP',
  totalSoldSql: 'SOLD',
}

describe('planDataNeeds', () => {
  it('requests only what the enabled sections use', () => {
    const needs = planDataNeeds([make({ type: 'brand_carousel' })])
    expect(needs.topBrands).toBe(true)
    expect(needs.heroSlides).toBe(false)
    expect(needs.categoryShowcase).toBe(false)
    expect(needs.dealOfTheDay).toBe(false)
  })

  it('requests everything the default layout uses', () => {
    const needs = planDataNeeds(defaults)
    expect(needs.heroSlides).toBe(true)
    expect(needs.mainCategories).toBe(true)
    expect(needs.topBrands).toBe(true)
    expect(needs.categoryShowcase).toBe(true)
    expect(needs.freeShippingThreshold).toBe(true)
    // not in the default layout
    expect(needs.dealOfTheDay).toBe(false)
  })

  it('fetches nothing for an empty page', () => {
    expect(Object.values(planDataNeeds([]))).toEqual([false, false, false, false, false, false, false])
  })
})

describe('planProductRows', () => {
  it('plans one query per distinct row', () => {
    const plan = planProductRows(defaults)
    expect([...plan.values()].map(v => v.source).sort()).toEqual(['best_sellers', 'featured', 'new_arrivals'])
  })

  it('collapses two identically-configured rows into one query', () => {
    const plan = planProductRows([
      make({ id: 'a', config: { source: 'featured' } }),
      make({ id: 'b', config: { source: 'featured' } }),
    ])
    expect(plan.size).toBe(1)
  })

  it('keeps rows that differ by limit or category separate', () => {
    const plan = planProductRows([
      make({ id: 'a', config: { source: 'featured', limit: 4 } }),
      make({ id: 'b', config: { source: 'featured', limit: 8 } }),
      make({ id: 'c', config: { source: 'category', categorySlug: 'tools' } }),
    ])
    expect(plan.size).toBe(3)
  })

  it('ignores non-product sections', () => {
    expect(planProductRows([make({ type: 'hero' }), make({ type: 'benefits' })]).size).toBe(0)
  })
})

describe('buildProductRowSql', () => {
  it('preserves the shared SELECT list across every source', () => {
    for (const source of ['featured', 'new_arrivals', 'best_sellers', 'on_sale'] as const) {
      const sql = buildProductRowSql(source, null, deps)
      expect(sql).toContain('json_agg(pi ORDER BY pi.display_order)')
      expect(sql).toContain('AS product_images')
      expect(sql).toContain('LEFT JOIN categories c')
      expect(sql).toContain('LEFT JOIN brands b')
      expect(sql).toContain('LIMIT $1')
    }
  })

  // These three must keep matching the queries they replace on the current homepage.
  it('matches the original featured filter', () => {
    const sql = buildProductRowSql('featured', null, deps)
    expect(sql).toContain('p.is_active = true AND p.is_featured = true')
  })

  it('matches the original new-arrivals ordering', () => {
    const sql = buildProductRowSql('new_arrivals', null, deps)
    expect(sql).toContain('WHERE p.is_active = true')
    expect(sql).toContain('ORDER BY p.created_at DESC')
    expect(sql).not.toContain('is_featured')
  })

  // The original query COALESCEs total_sold to 0 and orders without NULLS LAST; keeping the
  // exact clause avoids reordering the live best-sellers row.
  it('orders best sellers exactly as the original query did', () => {
    const sql = buildProductRowSql('best_sellers', null, deps)
    expect(sql).toContain('ORDER BY total_sold DESC, p.created_at DESC')
    expect(sql).not.toContain('NULLS LAST')
  })

  it('always selects total_sold, since best_sellers orders on it', () => {
    for (const source of ['featured', 'new_arrivals', 'best_sellers', 'on_sale'] as const) {
      expect(buildProductRowSql(source, null, deps)).toContain('AS total_sold')
    }
  })

  it('filters on-sale rows to discounted products', () => {
    expect(buildProductRowSql('on_sale', null, deps)).toContain('p.mrp > p.price')
  })

  it('parameterises the category slug rather than interpolating it', () => {
    const sql = buildProductRowSql('category', 'hand-tools', deps)
    expect(sql).toContain('c.slug = $2')
    expect(sql).not.toContain('hand-tools')
  })

  it('does not filter by category when no slug is given', () => {
    expect(buildProductRowSql('category', null, deps)).not.toContain('c.slug =')
  })
})
