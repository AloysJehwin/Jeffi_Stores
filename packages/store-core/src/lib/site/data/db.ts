import { queryMany } from '@/lib/shared/db'
import { getFeatureFlags, getStoreIdentity, getStorefrontContent } from '@/lib/catalog/site-controls'
import { storeAddressLine } from '@/lib/catalog/brand'
import { productCardProps } from '@/lib/catalog/product-card-props'
import { listActiveOffers } from '@/lib/catalog/product-offers'
import { offerHref } from '@/lib/catalog/product-offers-shared'
import { brandsFor, categoriesFor, productsFor, reviewsFor } from '../composed-data'
import { ProductQuery as ProductQuerySchema } from '../composed'
import { money, stars } from './format'
import { categoryPhotos, loadBrandIndex, loadBrandPage, loadCategoryIndex, loadCategoryPage } from './taxonomy'
import { safeSrc } from '../code/allow'
import type { ProductDetailView, ProductQuery, ProductView, SiteData } from './types'

// The live store as a SiteData source: the composed block's bound-parameter queries, mapped to views.

const NEW_DAYS = 30

async function ratingsFor(ids: string[]): Promise<Map<string, { rating: number; count: number }>> {
  if (!ids.length) return new Map()
  const rows = await queryMany<{ product_id: string; rating: string; n: string }>(
    `SELECT product_id, avg(rating) AS rating, count(*) AS n FROM product_reviews
      WHERE is_approved = true AND product_id = ANY($1::uuid[]) GROUP BY product_id`,
    [ids]
  )
  return new Map(rows.map(r => [r.product_id, { rating: Math.round(Number(r.rating) * 10) / 10, count: Number(r.n) }]))
}

function toView(row: any, gst: boolean, ratings: Map<string, { rating: number; count: number }>): ProductView {
  const c = productCardProps(row, gst)
  const images = (Array.isArray(row.product_images) ? row.product_images : []) as { image_url?: string; is_primary?: boolean }[]
  const primary = (c.primaryImage as { image_url?: string } | null)?.image_url ?? null
  const hover = images.map(i => i.image_url).find(u => u && u !== primary) ?? null
  const isNew = Date.parse(row.created_at ?? '') > Date.now() - NEW_DAYS * 86400_000
  const r = ratings.get(c.id)
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    url: `/products/${c.slug}`,
    image: primary,
    hoverImage: hover,
    price: money(c.displayPrice),
    mrp: c.mrp && c.mrp > c.displayPrice ? money(c.mrp) : null,
    discountPct: c.mrpDiscount,
    badge: c.mrpDiscount >= 5 ? `${c.mrpDiscount}% off` : isNew ? 'New' : row.is_featured ? 'Featured' : null,
    brand: c.brandName,
    category: c.categoryName,
    inStock: c.effectiveStock > 0 || c.isDigital,
    rating: r?.rating ?? null,
    reviewCount: r?.count ?? 0,
    hasVariants: !!c.hasVariants,
    brandSlug: row.brands?.slug ?? null,
    categorySlug: row.categories?.slug ?? null,
    categoryId: c.categoryId,
    isDigital: c.isDigital,
  }
}

async function products(q: ProductQuery): Promise<ProductView[]> {
  const parsed = ProductQuerySchema.safeParse(q)
  if (!parsed.success) return []
  const { gstEnabled } = await getFeatureFlags()
  const rows = await productsFor(parsed.data, gstEnabled)
  const ratings = await ratingsFor(rows.map(r => r.id as string))
  return rows.map(r => toView(r, gstEnabled, ratings))
}

const attributesOf = (spec: unknown): { name: string; value: string }[] =>
  spec && typeof spec === 'object' && !Array.isArray(spec)
    ? Object.entries(spec as Record<string, unknown>)
        .filter(([, v]) => v != null && v !== '' && typeof v !== 'object')
        .map(([name, v]) => ({ name, value: String(v) }))
    : []

async function product(slug: string): Promise<ProductDetailView | null> {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug)) return null
  const { gstEnabled } = await getFeatureFlags()
  const [row] = await productsFor({ slugs: [slug], sort: 'new', limit: 1 }, gstEnabled)
  if (!row) return null
  const view = toView(row, gstEnabled, await ratingsFor([row.id]))
  const images = ((row.product_images ?? []) as { image_url?: string }[]).map(i => i.image_url).filter((u): u is string => !!u)
  return {
    ...view,
    description: String(row.description ?? ''),
    shortDescription: String(row.short_description ?? ''),
    images,
    attributes: attributesOf(row.specifications),
  }
}

export function dbSiteData(): SiteData {
  return {
    products,
    product,
    async categories(q) {
      const rows = await categoriesFor({ parent: q.parent ?? null, slugs: q.slugs, limit: q.limit })
      // A category without a picture of its own shows its products' photo.
      const photos = await categoryPhotos(rows.filter(c => !safeSrc(c.image_url)).map(c => c.id)).catch(() => new Map<string, string>())
      return rows.map(c => ({ id: c.id, slug: c.slug, name: c.name, url: `/categories/${c.slug}`, image: safeSrc(c.image_url) ? c.image_url : (photos.get(c.id) ?? null) }))
    },
    async brands(q) {
      const rows = await brandsFor({ slugs: q.slugs, featured: q.featured, limit: q.limit })
      return rows.map(b => ({ id: b.id, slug: b.slug, name: b.name, url: `/brands/${b.slug}`, logo: b.logo_url }))
    },
    category: loadCategoryPage,
    brand: loadBrandPage,
    allCategories: loadCategoryIndex,
    allBrands: loadBrandIndex,
    async reviews(q) {
      const rows = await reviewsFor({ productSlug: q.productSlug, minRating: q.minRating, limit: q.limit })
      return rows.map(r => ({ ...r, stars: stars(r.rating), productUrl: `/products/${r.productSlug}` }))
    },
    async offers(q) {
      const rows = (await listActiveOffers()).slice(0, q.limit)
      return rows.map(o => ({
        id: o.id,
        slug: o.slug,
        title: o.title,
        subtitle: o.subtitle,
        badge: o.badge_text,
        image: o.image_url_card ?? o.image_url,
        mobileImage: o.image_url_mobile,
        url: offerHref(o.slug),
        cta: o.cta_label,
        endsAt: o.ends_at,
      }))
    },
    async store() {
      const [identity, content, address] = await Promise.all([getStoreIdentity(), getStorefrontContent(), storeAddressLine().catch(() => '')])
      return {
        name: identity.name,
        tagline: content.metaTagline,
        logo: identity.logoUrl || null,
        email: identity.email,
        phone: identity.phone,
        address,
        about: content.aboutCopy,
        year: new Date().getFullYear(),
        ...(identity.whatsapp ? { whatsapp: identity.whatsapp } : {}),
        ...(Object.keys(identity.socials).length ? { socials: identity.socials } : {}),
      }
    },
  }
}
