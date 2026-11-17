import { queryMany } from '@/lib/shared/db'
import { productCardProps } from '@/lib/catalog/product-card-props'
import { money } from '@/lib/site/data/format'
import { resolveImageUrls } from '@/lib/catalog/product-media-shared'
import type { ProductDetailView, ProductView } from '@/lib/site/data/types'

// Product rows (the product and listing pages' own queries) as the code sections' ProductView binding, mapped the way
// lib/site/data/db.ts maps the composed queries.

const NEW_DAYS = 30

export async function ratingsFor(ids: string[]): Promise<Map<string, { rating: number; count: number }>> {
  if (!ids.length) return new Map()
  const rows = await queryMany<{ product_id: string; rating: string; n: string }>(
    `SELECT product_id, avg(rating) AS rating, count(*) AS n FROM product_reviews
      WHERE is_approved = true AND product_id = ANY($1::uuid[]) GROUP BY product_id`,
    [ids]
  )
  return new Map(rows.map(r => [r.product_id, { rating: Math.round(Number(r.rating) * 10) / 10, count: Number(r.n) }]))
}

export function rowView(row: any, gst: boolean, rating?: { rating: number; count: number }, productBase = '/products'): ProductView {
  const c = productCardProps(row, gst)
  const images = (Array.isArray(row.product_images) ? row.product_images : []) as { image_url?: string }[]
  const primary = (c.primaryImage as { image_url?: string } | null)?.image_url ?? null
  const hover = images.map(i => i.image_url).find(u => u && u !== primary) ?? null
  const isNew = Date.parse(row.created_at ?? '') > Date.now() - NEW_DAYS * 86400_000
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    url: `${productBase}/${c.slug}`,
    image: primary,
    hoverImage: hover,
    price: money(Number(c.displayPrice)),
    mrp: c.mrp && c.mrp > Number(c.displayPrice) ? money(c.mrp) : null,
    discountPct: c.mrpDiscount,
    badge: c.mrpDiscount >= 5 ? `${c.mrpDiscount}% off` : isNew ? 'New' : row.is_featured ? 'Featured' : null,
    brand: c.brandName,
    category: c.categoryName,
    inStock: c.effectiveStock > 0 || c.isDigital,
    rating: rating?.rating ?? null,
    reviewCount: rating?.count ?? 0,
    hasVariants: !!c.hasVariants,
    brandSlug: row.brands?.slug ?? null,
    categorySlug: row.categories?.slug ?? null,
    categoryId: c.categoryId,
    isDigital: c.isDigital,
  }
}

export async function rowViews(rows: any[], gst: boolean, productBase = '/products'): Promise<ProductView[]> {
  const ratings = await ratingsFor(rows.map(r => String(r.id))).catch(() => new Map<string, { rating: number; count: number }>())
  return rows.map(r => rowView(r, gst, ratings.get(String(r.id)), productBase))
}

const attributesOf = (spec: unknown): { name: string; value: string }[] =>
  spec && typeof spec === 'object' && !Array.isArray(spec)
    ? Object.entries(spec as Record<string, unknown>)
        .filter(([, v]) => v != null && v !== '' && typeof v !== 'object')
        .map(([name, v]) => ({ name, value: String(v) }))
    : []

/** The product page's own row (with its media and review summary) as the `<Product>` binding. */
export function detailView(row: any, gst: boolean, summary: { average: number; total: number } | null): ProductDetailView {
  const view = rowView(row, gst, summary && summary.total > 0 ? { rating: Math.round(summary.average * 10) / 10, count: summary.total } : undefined)
  const fromMedia = resolveImageUrls(row.media ?? [])
  const images = fromMedia.length
    ? fromMedia
    : ((row.product_images ?? []) as { image_url?: string }[]).map(i => i.image_url).filter((u): u is string => !!u)
  return {
    ...view,
    image: view.image ?? images[0] ?? null,
    description: String(row.description ?? ''),
    shortDescription: String(row.short_description ?? ''),
    images,
    attributes: attributesOf(row.specifications),
  }
}
