import { queryMany, queryOne } from '@/lib/db'
import { getProductCards, getProductCardsByIds } from '@/lib/product-cards'
import { VARIANT_STOCK_TOTAL_SQL } from '@/lib/queries'
import {
  configId,
  configIds,
  configNumber,
  sectionLimit,
  valueStatMetrics,
  type HomepageSection,
  type SectionType,
  type ValueStatMetric,
} from '@/lib/homepage-sections'

type SectionShape = Pick<HomepageSection, 'type' | 'config'>

export interface CountdownDealData {
  product: any
  endsAt: string | null
}

export interface Testimonial {
  id: string
  rating: number
  title: string | null
  comment: string
  author: string
  verified: boolean
  productName: string
  productSlug: string
}

export interface CategoryTab {
  id: string
  name: string
  slug: string
  products: any[]
}

export interface ValueStat {
  metric: ValueStatMetric
  label: string
  value: number
}

// Matches productCardProps: a variant product is in stock when a variant is, a simple one by status.
const IN_STOCK_SQL = `((p.has_variants AND (${VARIANT_STOCK_TOTAL_SQL}) > 0)
  OR (NOT p.has_variants AND p.stock_status IS DISTINCT FROM 'Out of Stock'))`

const categoryTree = (root: string) => `(
  WITH RECURSIVE tree AS (
    SELECT id FROM categories WHERE id = ${root}
    UNION ALL
    SELECT c.id FROM categories c JOIN tree t ON c.parent_category_id = t.id WHERE c.is_active = true
  ) SELECT id FROM tree)`

/** The picked product, or null once its countdown has ended or the product is gone. */
export async function getCountdownDeal(
  section: SectionShape,
  gstEnabled: boolean,
  now = Date.now()
): Promise<CountdownDealData | null> {
  const productId = configId(section, 'productId')
  if (!productId) return null
  const raw = section.config?.endsAt
  const endsAt = typeof raw === 'string' && Number.isFinite(Date.parse(raw)) ? raw : null
  if (endsAt && Date.parse(endsAt) <= now) return null
  const [product] = await getProductCardsByIds([productId], gstEnabled)
  return product ? { product, endsAt } : null
}

function reviewerName(first: string | null, last: string | null): string {
  const f = (first ?? '').trim()
  const l = (last ?? '').trim()
  if (!f) return 'A customer'
  return l ? `${f} ${l[0].toUpperCase()}.` : f
}

export async function getTestimonials(section: SectionShape): Promise<Testimonial[]> {
  const rows = await queryMany<{
    id: string
    rating: number
    title: string | null
    comment: string
    is_verified_purchase: boolean
    product_name: string
    product_slug: string
    first_name: string | null
    last_name: string | null
  }>(
    `SELECT r.id, r.rating, r.title, r.comment, r.is_verified_purchase,
            p.name AS product_name, p.slug AS product_slug, u.first_name, u.last_name
     FROM product_reviews r
     JOIN products p ON p.id = r.product_id AND p.is_active = true
     LEFT JOIN users u ON u.id = r.user_id
     WHERE r.is_approved = true AND r.rating >= $1 AND length(btrim(COALESCE(r.comment, ''))) >= 20
     ORDER BY r.rating DESC, r.is_verified_purchase DESC, r.created_at DESC
     LIMIT $2`,
    [configNumber(section, 'minRating', 4, 5), sectionLimit(section, 6)]
  )
  return rows.map(r => ({
    id: r.id,
    rating: Number(r.rating),
    title: r.title?.trim() || null,
    comment: r.comment.trim(),
    author: reviewerName(r.first_name, r.last_name),
    verified: !!r.is_verified_purchase,
    productName: r.product_name,
    productSlug: r.product_slug,
  }))
}

/** Picked categories in the saved order, else the top-level categories with the most live products. */
export async function getCategoryTabs(section: SectionShape, gstEnabled: boolean): Promise<CategoryTab[]> {
  const tabCount = configNumber(section, 'tabs', 4, 8)
  const picked = configIds(section, 'categoryIds')
  let categories: { id: string; name: string; slug: string }[]
  if (picked.length > 0) {
    const rows = await queryMany<{ id: string; name: string; slug: string }>(
      `SELECT id, name, slug FROM categories WHERE id = ANY($1::uuid[]) AND is_active = true`,
      [picked]
    )
    const byId = new Map(rows.map(r => [r.id, r]))
    categories = picked.map(id => byId.get(id)).filter((c): c is { id: string; name: string; slug: string } => !!c)
  } else {
    categories = await queryMany<{ id: string; name: string; slug: string }>(
      `SELECT c.id, c.name, c.slug
       FROM categories c
       WHERE c.parent_category_id IS NULL AND c.is_active = true
       ORDER BY (SELECT count(*) FROM products p WHERE p.is_active = true AND p.category_id IN ${categoryTree('c.id')}) DESC,
                c.display_order ASC
       LIMIT $1`,
      [tabCount]
    )
  }
  const tabs = await Promise.all(
    categories.slice(0, tabCount).map(async c => ({
      ...c,
      products: await getProductCards({
        where: `p.is_active = true AND p.category_id IN ${categoryTree('$1::uuid')}`,
        orderBy: 'p.sales_count DESC NULLS LAST, p.created_at DESC',
        params: [c.id],
        limit: sectionLimit(section, 8),
        gstEnabled,
      }),
    }))
  )
  return tabs.filter(t => t.products.length > 0)
}

/** Picked products, else every product flagged as a bundle. */
export async function getBundles(section: SectionShape, gstEnabled: boolean): Promise<any[]> {
  const limit = sectionLimit(section, 4)
  const picked = configIds(section, 'productIds')
  if (picked.length > 0) return (await getProductCardsByIds(picked, gstEnabled)).slice(0, limit)
  return getProductCards({
    where: 'p.is_active = true AND p.is_bundle = true',
    orderBy: 'p.is_featured DESC, p.sales_count DESC NULLS LAST, p.created_at DESC',
    limit,
    gstEnabled,
  })
}

/**
 * Moments a product came back, as (product_key, created_at) rows inside the window. Either signal counts:
 * - inventory stock: a quantity increase from zero or below, in inventory_transactions (purchases,
 *   returns, adjustments) or shelf_stock_transactions (shelf-managed stock);
 * - stock status: a product, variant or sub-variant flipped from Out of Stock to In/Low Stock, read from
 *   admin_audit_log, which the row-audit trigger writes on every change (it skips inventory_quantity,
 *   hence the ledgers above).
 */
function restockEvents(days: string, product?: string): string {
  const own = (col: string, asText = false) => (product ? ` AND ${col} = ${product}${asText ? '::text' : ''}` : '')
  const since = `now() - make_interval(days => ${days})`
  return `(
    SELECT t.product_id::text AS product_key, t.created_at FROM inventory_transactions t
    WHERE t.quantity_change > 0 AND t.quantity_after - t.quantity_change <= 0 AND t.created_at > ${since}${own('t.product_id')}
    UNION ALL
    SELECT s.product_id::text, s.created_at FROM shelf_stock_transactions s
    WHERE s.quantity_change > 0 AND s.quantity_after - s.quantity_change <= 0 AND s.created_at > ${since}${own('s.product_id')}
    UNION ALL
    SELECT CASE WHEN a.entity_type = 'products' THEN a.entity_id ELSE a.metadata->>'product_id' END, a.created_at
    FROM admin_audit_log a
    WHERE a.entity_type IN ('products', 'product_variants', 'product_sub_variants')
      AND a.diff->'stock_status'->>'from' = 'Out of Stock'
      AND a.diff->'stock_status'->>'to' IN ('In Stock', 'Low Stock')
      AND a.created_at > ${since}${own("CASE WHEN a.entity_type = 'products' THEN a.entity_id ELSE a.metadata->>'product_id' END", true)}
  )`
}

/**
 * In stock now after coming back within the window. Products shoppers were waiting on
 * (back-in-stock requests, wishlists) come first, then the most recent return to stock.
 */
export async function getBackInStock(section: SectionShape, gstEnabled: boolean): Promise<any[]> {
  return getProductCards({
    where: `p.is_active = true AND ${IN_STOCK_SQL}
      AND p.id::text IN (SELECT r.product_key FROM ${restockEvents('$1::int')} r)`,
    orderBy: `((SELECT count(*) FROM back_in_stock_notify n WHERE n.product_id = p.id)
      + (SELECT count(*) FROM wishlist_items w WHERE w.product_id = p.id)) DESC,
      (SELECT max(r.created_at) FROM ${restockEvents('$1::int', 'p.id')} r) DESC NULLS LAST`,
    params: [configNumber(section, 'days', 14, 90)],
    limit: sectionLimit(section, 8),
    gstEnabled,
  })
}

/** Live counts for the picked metrics; a metric that is still zero is left out. */
export async function getValueStats(section: SectionShape): Promise<ValueStat[]> {
  const metrics = valueStatMetrics(section)
  if (metrics.length === 0) return []
  const row = await queryOne<Record<ValueStatMetric, string>>(
    `SELECT
       (SELECT count(*) FROM orders WHERE shipped_at IS NOT NULL OR status IN ('shipped', 'delivered')) AS orders_shipped,
       (SELECT count(*) FROM products WHERE is_active = true) AS products,
       (SELECT count(DISTINCT lower(btrim(a.city))) FROM orders o JOIN addresses a ON a.id = o.shipping_address_id
         WHERE o.status <> 'cancelled') AS cities,
       (SELECT count(DISTINCT user_id) FROM orders WHERE status <> 'cancelled') AS customers`
  )
  return metrics.map(m => ({ ...m, value: Number(row?.[m.metric] ?? 0) })).filter(s => s.value > 0)
}

const LOADERS: Partial<Record<SectionType, (s: SectionShape, gstEnabled: boolean) => Promise<unknown>>> = {
  countdown_deal: (s, gst) => getCountdownDeal(s, gst),
  testimonials: s => getTestimonials(s),
  category_tabs: getCategoryTabs,
  bundle_spotlight: getBundles,
  back_in_stock: getBackInStock,
  value_stats: s => getValueStats(s),
}

/** Data for the section types that load their own, keyed by section id. A failing section is skipped. */
export async function loadSectionExtras(
  sections: HomepageSection[],
  gstEnabled: boolean
): Promise<Map<string, unknown>> {
  const entries = await Promise.all(
    sections.map(async s => {
      const load = LOADERS[s.type]
      if (!load) return null
      try {
        return [s.id, await load(s, gstEnabled)] as const
      } catch (err) {
        console.error('[homepage-extras]', s.type, err)
        return null
      }
    })
  )
  return new Map(entries.filter((e): e is readonly [string, unknown] => e !== null))
}
