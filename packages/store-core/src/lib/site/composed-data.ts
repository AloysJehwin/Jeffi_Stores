import { queryMany, queryOne } from '@/lib/shared/db'
import { getProductCards } from '@/lib/catalog/product-cards'
import { listActiveOffers } from '@/lib/catalog/product-offers'
import { VARIANT_STOCK_TOTAL_SQL } from '@/lib/queries'
import { walkTree, type ComposedNode, type NodeOf, type ProductQuery } from './composed'

// Live data for a composed block's data nodes, keyed by node path. Queries are built here from the node's small query
// language with bound parameters; nothing the AI or owner writes reaches SQL as text. Also the AI's read-only tools.

const IN_STOCK_SQL = `((p.has_variants AND (${VARIANT_STOCK_TOTAL_SQL}) > 0) OR (NOT p.has_variants AND p.stock_status IS DISTINCT FROM 'Out of Stock'))`

const SORTS: Record<ProductQuery['sort'], string> = {
  featured: 'p.is_featured DESC, p.created_at DESC',
  new: 'p.created_at DESC',
  best_sellers: 'total_sold DESC, p.created_at DESC',
  price_asc: 'p.base_price ASC',
  price_desc: 'p.base_price DESC',
  discount: '(COALESCE(p.mrp, p.base_price) - p.base_price) DESC, p.created_at DESC',
}

/** WHERE / ORDER BY / params for a product query (card SQL aliases: p products, c categories, b brands). */
export function productQuerySql(q: ProductQuery): { where: string; orderBy: string; params: unknown[] } {
  const params: unknown[] = []
  const $ = (v: unknown) => (params.push(v), `$${params.length}`)
  const where = ['p.is_active = true', 'p.is_draft IS NOT TRUE']
  if (q.category)
    where.push(`p.category_id IN (WITH RECURSIVE tree AS (SELECT id FROM categories WHERE slug = ${$(q.category)}
      UNION ALL SELECT c2.id FROM categories c2 JOIN tree t ON c2.parent_category_id = t.id WHERE c2.is_active = true) SELECT id FROM tree)`)
  if (q.brand) where.push(`b.slug = ${$(q.brand)}`)
  if (q.search) {
    const s = $(q.search)
    where.push(`(p.name ILIKE '%' || ${s} || '%' OR p.search_vector @@ plainto_tsquery('simple', ${s}))`)
  }
  if (q.minPrice != null) where.push(`p.base_price >= ${$(q.minPrice)}`)
  if (q.maxPrice != null) where.push(`p.base_price <= ${$(q.maxPrice)}`)
  if (q.onSale) where.push('(p.mrp > p.base_price OR COALESCE(p.discount_pct, 0) > 0)')
  if (q.inStock) where.push(IN_STOCK_SQL)
  if (q.featured) where.push('p.is_featured = true')
  let orderBy = SORTS[q.sort] ?? SORTS.new
  if (q.slugs?.length) {
    const s = $(q.slugs)
    where.push(`p.slug = ANY(${s}::text[])`)
    orderBy = `array_position(${s}::text[], p.slug::text)`
  }
  return { where: where.join(' AND '), orderBy, params }
}

export function productsFor(q: ProductQuery, gstEnabled?: boolean) {
  const { where, orderBy, params } = productQuerySql(q)
  return getProductCards({ where, orderBy, params, limit: q.limit, gstEnabled })
}

export interface CategoryTile {
  id: string
  name: string
  slug: string
  image_url: string | null
}
export function categoriesFor(q: NodeOf<'categories'>['query']): Promise<CategoryTile[]> {
  if (q.slugs?.length)
    return queryMany(
      `SELECT id, name, slug, image_url FROM categories WHERE is_active = true AND is_draft IS NOT TRUE AND slug = ANY($1::text[])
        ORDER BY array_position($1::text[], slug::text) LIMIT $2`,
      [q.slugs, q.limit]
    )
  return queryMany(
    `SELECT c.id, c.name, c.slug, c.image_url FROM categories c
      WHERE c.is_active = true AND c.is_draft IS NOT TRUE
        AND ${q.parent ? 'c.parent_category_id = (SELECT id FROM categories WHERE slug = $2)' : 'c.parent_category_id IS NULL'}
      ORDER BY c.display_order ASC NULLS LAST, c.name LIMIT $1`,
    q.parent ? [q.limit, q.parent] : [q.limit]
  )
}

export interface BrandTile {
  id: string
  name: string
  slug: string
  logo_url: string | null
}
export function brandsFor(q: NodeOf<'brands'>['query']): Promise<BrandTile[]> {
  return queryMany(
    `SELECT id, name, slug, logo_url FROM brands
      WHERE is_active = true AND is_draft IS NOT TRUE ${q.slugs?.length ? 'AND slug = ANY($2::text[])' : ''} ${q.featured ? 'AND is_featured = true' : ''}
      ORDER BY ${q.slugs?.length ? 'array_position($2::text[], slug::text)' : 'display_order ASC NULLS LAST, name'} LIMIT $1`,
    q.slugs?.length ? [q.limit, q.slugs] : [q.limit]
  )
}

export interface ReviewQuote {
  id: string
  rating: number
  title: string | null
  comment: string
  author: string
  productName: string
  productSlug: string
}
export async function reviewsFor(q: NodeOf<'review'>['query']): Promise<ReviewQuote[]> {
  const rows = await queryMany<{ id: string; rating: number; title: string | null; comment: string; product_name: string; product_slug: string; first_name: string | null; last_name: string | null }>(
    `SELECT r.id, r.rating, r.title, r.comment, p.name AS product_name, p.slug AS product_slug, u.first_name, u.last_name
       FROM product_reviews r
       JOIN products p ON p.id = r.product_id AND p.is_active = true
       LEFT JOIN users u ON u.id = r.user_id
      WHERE r.is_approved = true AND r.rating >= $1 AND length(btrim(COALESCE(r.comment, ''))) >= 20 ${q.productSlug ? 'AND p.slug = $3' : ''}
      ORDER BY r.rating DESC, r.is_verified_purchase DESC, r.created_at DESC LIMIT $2`,
    q.productSlug ? [q.minRating, q.limit, q.productSlug] : [q.minRating, q.limit]
  )
  return rows.map(r => ({
    id: r.id,
    rating: Number(r.rating),
    title: r.title?.trim() || null,
    comment: r.comment.trim(),
    author: [r.first_name?.trim(), r.last_name?.trim()?.[0] ? `${r.last_name.trim()[0]}.` : ''].filter(Boolean).join(' ') || 'A customer',
    productName: r.product_name,
    productSlug: r.product_slug,
  }))
}

export type ComposedData = Record<string, unknown>

/** Every data node's results, by path. A failing node gets an empty list. */
export async function loadComposedData(tree: ComposedNode | null, gstEnabled?: boolean): Promise<ComposedData> {
  const jobs: Promise<readonly [string, unknown]>[] = []
  walkTree(tree, (n, path) => {
    const load: (() => Promise<unknown>) | null =
      n.kind === 'products'
        ? () => productsFor(n.query, gstEnabled)
        : n.kind === 'categories'
          ? () => categoriesFor(n.query)
          : n.kind === 'brands'
            ? () => brandsFor(n.query)
            : n.kind === 'review'
              ? () => reviewsFor(n.query)
              : n.kind === 'offers'
                ? () => listActiveOffers().then(o => o.slice(0, n.query.limit))
                : null
    if (load)
      jobs.push(
        load().then(
          r => [path, r] as const,
          err => (console.error('[composed]', n.kind, err), [path, []] as const)
        )
      )
  })
  return Object.fromEntries(await Promise.all(jobs))
}

// ── The AI's read-only tools: compact answers, scoped to this store ─────────────────────────────

const price = (r: Record<string, unknown>) => Number(r.variant_min_price ?? r.base_price ?? 0)

export const DATA_TOOLS = {
  async list_categories() {
    return queryMany<{ slug: string; name: string; parent: string | null; products: string }>(
      `SELECT c.slug, c.name, p.slug AS parent,
              (SELECT count(*) FROM products x WHERE x.category_id = c.id AND x.is_active = true) AS products
         FROM categories c LEFT JOIN categories p ON p.id = c.parent_category_id
        WHERE c.is_active = true AND c.is_draft IS NOT TRUE ORDER BY c.parent_category_id NULLS FIRST, c.display_order NULLS LAST LIMIT 60`
    ).then(r => r.map(c => ({ ...c, products: Number(c.products) })))
  },
  async list_brands() {
    return queryMany<{ slug: string; name: string; featured: boolean; products: string }>(
      `SELECT b.slug, b.name, b.is_featured AS featured,
              (SELECT count(*) FROM products x WHERE x.brand_id = b.id AND x.is_active = true) AS products
         FROM brands b WHERE b.is_active = true AND b.is_draft IS NOT TRUE ORDER BY products DESC, b.name LIMIT 40`
    ).then(r => r.map(b => ({ ...b, products: Number(b.products) })))
  },
  async search_products(args: unknown) {
    const q = (await import('./composed')).ProductQuery.safeParse({ limit: 10, ...(args as object) })
    if (!q.success) return { error: q.error.issues[0]?.message }
    const rows = await productsFor({ ...q.data, limit: Math.min(q.data.limit, 12) })
    return rows.map(r => ({
      slug: r.slug,
      name: r.name,
      price: price(r),
      mrp: r.mrp ? Number(r.mrp) : null,
      category: r.categories?.slug ?? null,
      brand: r.brands?.name ?? null,
      images: Array.isArray(r.product_images) ? r.product_images.length : 0,
    }))
  },
  async get_product(args: unknown) {
    const slug = String((args as { slug?: unknown })?.slug ?? '')
    const [r] = slug ? await productsFor({ slugs: [slug], sort: 'new', limit: 1 }) : []
    if (!r) return { error: 'No such product' }
    return {
      slug: r.slug,
      name: r.name,
      price: price(r),
      mrp: r.mrp ? Number(r.mrp) : null,
      category: r.categories?.slug ?? null,
      brand: r.brands?.name ?? null,
      description: String(r.short_description ?? r.description ?? '').slice(0, 400),
      images: (Array.isArray(r.product_images) ? r.product_images : []).slice(0, 3).map((i: { image_url?: string }) => i.image_url).filter(Boolean),
    }
  },
  async list_offers() {
    return (await listActiveOffers()).slice(0, 10).map(o => ({ slug: o.slug, title: o.title, subtitle: o.subtitle, ends: o.ends_at }))
  },
  async top_reviews(args: unknown) {
    const limit = Math.min(6, Math.max(1, Number((args as { limit?: unknown })?.limit ?? 4)))
    return (await reviewsFor({ minRating: 4, limit })).map(r => ({ product: r.productSlug, rating: r.rating, excerpt: r.comment.slice(0, 160) }))
  },
  async store_stats() {
    const r = await queryOne<Record<string, string>>(
      `SELECT (SELECT count(*) FROM products WHERE is_active = true) AS products,
              (SELECT count(*) FROM products WHERE is_active = true AND (mrp > base_price OR COALESCE(discount_pct, 0) > 0)) AS on_sale,
              (SELECT count(*) FROM categories WHERE is_active = true) AS categories,
              (SELECT count(*) FROM brands WHERE is_active = true) AS brands,
              (SELECT count(*) FROM product_reviews WHERE is_approved = true) AS reviews,
              (SELECT min(base_price) FROM products WHERE is_active = true) AS min_price,
              (SELECT max(base_price) FROM products WHERE is_active = true) AS max_price`
    )
    return Object.fromEntries(Object.entries(r ?? {}).map(([k, v]) => [k, Number(v ?? 0)]))
  },
} as const

export type DataToolName = keyof typeof DATA_TOOLS
