import { queryMany } from '@/lib/db'
import {
  productRowKey, productSource, sectionLimit, visibleSections, withDefaults,
  type HomepageSection, type ProductSource,
} from '@/lib/homepage-sections'

export async function getConfiguredSections(): Promise<HomepageSection[]> {
  try {
    const rows = await queryMany<HomepageSection>(
      `SELECT id, type, title, subtitle, eyebrow, cta_label, cta_url, config,
              display_order, is_active, starts_at, ends_at
       FROM homepage_sections
       ORDER BY display_order ASC, created_at ASC`,
    )
    // Window filtering happens in JS, never SQL: a SQL NOW() would be baked into the
    // page's ISR cache entry and never re-evaluate.
    return visibleSections(withDefaults(rows))
  } catch {
    // Table missing or unreachable — fall back to the built-in layout rather than an empty page.
    return visibleSections(withDefaults([]))
  }
}

interface SourceClause {
  where: string
  orderBy: string
}

// The three previously separate queries (featured / new arrivals / best sellers) shared an
// identical SELECT list and differed only here.
function sourceClause(source: ProductSource, categorySlug: string | null): SourceClause {
  switch (source) {
    case 'new_arrivals':
      return { where: 'p.is_active = true', orderBy: 'p.created_at DESC' }
    case 'best_sellers':
      return { where: 'p.is_active = true', orderBy: 'total_sold DESC, p.created_at DESC' }
    case 'on_sale':
      return { where: 'p.is_active = true AND p.mrp > p.price', orderBy: '(p.mrp - p.price) DESC' }
    case 'category':
      return {
        where: categorySlug
          ? 'p.is_active = true AND c.slug = $2'
          : 'p.is_active = true',
        orderBy: 'p.created_at DESC',
      }
    case 'featured':
    default:
      return { where: 'p.is_active = true AND p.is_featured = true', orderBy: 'p.created_at DESC' }
  }
}

export interface ProductRowQueryDeps {
  minPriceSql: string
  variantStockTotalSql: string
  variantMinMrpSql: string
  /** Must COALESCE to 0 — best_sellers orders on this without NULLS LAST. */
  totalSoldSql: string
}

export function buildProductRowSql(
  source: ProductSource,
  categorySlug: string | null,
  deps: ProductRowQueryDeps,
): string {
  const { where, orderBy } = sourceClause(source, categorySlug)
  return buildProductCardSql({ where, orderBy, limit: '$1' }, deps)
}

/** The card-ready SELECT every product row uses, for any WHERE / ORDER BY / LIMIT placeholder. */
export function buildProductCardSql(
  { where, orderBy, limit }: { where: string; orderBy: string; limit: string },
  deps: ProductRowQueryDeps,
): string {
  return `
    SELECT p.*,
      json_build_object('id', c.id, 'name', c.name, 'slug', c.slug) AS categories,
      json_build_object('id', b.id, 'name', b.name) AS brands,
      COALESCE(
        (SELECT json_agg(pi ORDER BY pi.display_order)
         FROM product_images pi WHERE pi.product_id = p.id),
        '[]'::json
      ) AS product_images,
      ${deps.variantStockTotalSql} AS variant_stock_total,
      ${deps.minPriceSql} AS variant_min_price,
      ${deps.variantMinMrpSql} AS variant_min_mrp,
      ${deps.totalSoldSql} AS total_sold
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE ${where}
    ORDER BY ${orderBy}
    LIMIT ${limit}
  `
}

/**
 * Which product rows a page needs, de-duplicated. Two rows configured identically
 * (same source, limit and category) resolve to one query.
 */
export function planProductRows(sections: HomepageSection[]): Map<string, { source: ProductSource; limit: number; categorySlug: string | null }> {
  const plan = new Map<string, { source: ProductSource; limit: number; categorySlug: string | null }>()
  for (const s of sections) {
    if (s.type !== 'product_row') continue
    const limit = sectionLimit(s, 8)
    const key = productRowKey(s, limit)
    if (plan.has(key)) continue
    const categorySlug = typeof s.config?.categorySlug === 'string' ? s.config.categorySlug : null
    plan.set(key, { source: productSource(s), limit, categorySlug })
  }
  return plan
}

/** The non-product data each enabled section type needs. Nothing else is fetched. */
export function planDataNeeds(sections: HomepageSection[]) {
  const types = new Set(sections.map(s => s.type))
  return {
    heroSlides: types.has('hero'),
    offerSlider: types.has('offer_slider'),
    mainCategories: types.has('category_grid'),
    topBrands: types.has('brand_carousel'),
    categoryShowcase: types.has('category_showcase'),
    dealOfTheDay: types.has('deal_of_the_day'),
    freeShippingThreshold: types.has('trust_strip'),
  }
}
