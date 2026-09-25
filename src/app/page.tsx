import { queryMany } from '@/lib/db'
import { heroSlideHref } from '@/lib/hero-slides'
import { VARIANT_MIN_PRICE_INCL_GST_SQL, VARIANT_MIN_PRICE_EX_GST_SQL, VARIANT_MIN_MRP_SQL, VARIANT_STOCK_TOTAL_SQL } from '@/lib/queries'
import ReviewCouponPopup from '@/components/visitor/ReviewCouponPopup'
import SectionRenderer from '@/components/visitor/home/SectionRenderer'
import { getHost } from '@/lib/get-host'
import { getStorefrontContent, getFeatureFlags, getStoreIdentity } from '@/lib/site-controls'
import { getConfiguredSections, buildProductRowSql, planDataNeeds, planProductRows } from '@/lib/homepage-data'
import { loadSectionExtras } from '@/lib/homepage-extras'
import { productRowKey, sectionLimit, defaultAboutCopy, resolveAboutStats, type ProductSource } from '@/lib/homepage-sections'
import { listActiveOffers, listOffersByIds } from '@/lib/product-offers'

export const revalidate = 120

// Replaces the separate featured / new-arrivals / best-sellers queries, which shared this
// SELECT list and differed only in WHERE and ORDER BY.w
async function getProductsForSource(
  source: ProductSource,
  limit: number,
  categorySlug: string | null,
  gstEnabled: boolean,
) {
  const MIN_PRICE_SQL = gstEnabled ? VARIANT_MIN_PRICE_INCL_GST_SQL : VARIANT_MIN_PRICE_EX_GST_SQL
  const sql = buildProductRowSql(source, categorySlug, {
    minPriceSql: MIN_PRICE_SQL,
    variantStockTotalSql: VARIANT_STOCK_TOTAL_SQL,
    variantMinMrpSql: VARIANT_MIN_MRP_SQL,
    totalSoldSql: `COALESCE((SELECT SUM(oi.quantity) FROM order_items oi WHERE oi.product_id = p.id), 0)`,
  })
  const params: unknown[] = [limit]
  if (source === 'category' && categorySlug) params.push(categorySlug)
  return queryMany(sql, params)
}



async function getMainCategories() {
  return queryMany(`
    SELECT * FROM categories
    WHERE parent_category_id IS NULL AND is_active = true
    ORDER BY display_order ASC
    LIMIT 8
  `)
}

async function getHeroSlides() {
  // Prefer admin-managed hero_slides. Each carries its own copy, image and a CTA
  // link built from assigned product filters (or a manual URL).
  const managed = await queryMany<any>(
    `SELECT * FROM hero_slides WHERE is_active = true ORDER BY display_order ASC, created_at ASC`
  )
  if (managed.length > 0) {
    return managed.map(s => ({
      id: s.id,
      title: s.title,
      subtitle: s.subtitle,
      badge_text: s.badge_text,
      badge_color: s.badge_color,
      image_url: s.image_url,
      image_url_mobile: s.image_url_mobile,
      blurhash: s.blurhash,
      blurhash_mobile: s.blurhash_mobile,
      href: heroSlideHref(s),
    }))
  }

  // Fallback: derive slides from active parent categories (legacy behaviour).
  // Pick 4 categories daily using a date-seeded deterministic shuffle.
  const all = await queryMany<{
    name: string; slug: string;
    hero_image_mobile: string | null; hero_image_desktop: string | null;
  }>(`
    SELECT name, slug, hero_image_mobile, hero_image_desktop
    FROM categories
    WHERE parent_category_id IS NULL AND is_active = true
    ORDER BY display_order ASC
  `)

  // Date seed: days since epoch — changes once per day
  const daySeed = Math.floor(Date.now() / 86_400_000)

  // Fisher-Yates with seeded PRNG (mulberry32)
  function mulberry32(seed: number) {
    return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
  }
  const rng = mulberry32(daySeed)
  const shuffled = [...all]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }

  return shuffled.slice(0, 4)
}


async function getTopBrands() {
  return queryMany<{ id: string; name: string; slug: string; product_count: number }>(`
    SELECT b.id, b.name, b.slug, COUNT(p.id)::int AS product_count
    FROM brands b
    JOIN products p ON p.brand_id = b.id AND p.is_active = true
    GROUP BY b.id, b.name, b.slug
    HAVING COUNT(p.id) >= 2
    ORDER BY COUNT(p.id) DESC
    LIMIT 8
  `)
}

async function getDealOfTheDay(gstEnabled: boolean) {
  const MIN_PRICE_SQL = gstEnabled ? VARIANT_MIN_PRICE_INCL_GST_SQL : VARIANT_MIN_PRICE_EX_GST_SQL
  return queryMany(`
    SELECT p.*,
      json_build_object('id', c.id, 'name', c.name, 'slug', c.slug) AS categories,
      json_build_object('id', b.id, 'name', b.name) AS brands,
      COALESCE(
        (SELECT json_agg(pi ORDER BY pi.display_order)
         FROM product_images pi WHERE pi.product_id = p.id),
        '[]'::json
      ) AS product_images,
      ${VARIANT_STOCK_TOTAL_SQL} AS variant_stock_total,
      ${MIN_PRICE_SQL} AS variant_min_price,
      ${VARIANT_MIN_MRP_SQL} AS variant_min_mrp
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE p.is_active = true AND p.is_featured = true
    ORDER BY RANDOM()
    LIMIT 4
  `)
}

async function getFreeShippingThreshold() {
  // Use the SAME setting checkout/shipping uses (delivery_free_threshold) so the
  // homepage always matches the real free-delivery threshold — not the stale,
  // separate 'free_shipping_threshold' key.
  const { getDeliverySettings } = await import('@/lib/delivery-settings')
  const { freeThreshold } = await getDeliverySettings()
  return freeThreshold
}

async function getCategoryShowcase() {
  const categories = await queryMany<{ id: string; name: string; slug: string }>(`
    SELECT c.id, c.name, c.slug FROM categories c
    JOIN categories sub ON sub.parent_category_id = c.id
    JOIN products p ON p.category_id = sub.id AND p.is_active = true
    WHERE c.parent_category_id IS NULL AND c.is_active = true
    GROUP BY c.id, c.name, c.slug
    HAVING COUNT(p.id) >= 2
    ORDER BY COUNT(p.id) DESC LIMIT 4
  `)
  const result = await Promise.all(categories.map(async cat => {
    const products = await queryMany(`
      SELECT p.id, p.name, p.slug, p.has_variants,
        p.base_price, p.price_ex_gst, p.discount_pct,
        (SELECT json_agg(json_build_object('image_url', pi2.image_url, 'thumbnail_url', pi2.thumbnail_url))
          FROM product_images pi2 WHERE pi2.product_id = p.id LIMIT 1) AS product_images,
        MIN(pv.price) FILTER (WHERE pv.is_active) AS variant_min_price
      FROM products p
      JOIN categories sub ON p.category_id = sub.id AND sub.parent_category_id = $1
      LEFT JOIN product_variants pv ON pv.product_id = p.id
      WHERE p.is_active = true
      GROUP BY p.id
      ORDER BY p.is_featured DESC, p.created_at DESC
      LIMIT 5
    `, [cat.id])
    return { ...cat, products }
  }))
  return result.filter(c => c.products.length >= 2)
}

export default async function HomePage() {
  const storefront = await getStorefrontContent()
  const { gstEnabled } = await getFeatureFlags()

  const stats = resolveAboutStats(storefront.statsJson)
  // The flagship's own copy now lives in site-controls and is withheld from tenants, so an
  // unset value here means a tenant that has not written one yet — name it rather than
  // describing someone else's trade.
  const identity = await getStoreIdentity()
  const aboutCopy = defaultAboutCopy(storefront.aboutCopy, identity.name)

  const sections = await getConfiguredSections()
  const needs = planDataNeeds(sections)
  const rowPlan = planProductRows(sections)

  // Honor the offer-slider section's picked offers (config.offerIds); fall back to all active.
  const offerSection = sections.find(s => s.type === 'offer_slider')
  const rawOfferIds = offerSection?.config?.offerIds
  const pickedOfferIds = Array.isArray(rawOfferIds)
    ? rawOfferIds.filter((id): id is string => typeof id === 'string')
    : []

  const extrasPromise = loadSectionExtras(sections, gstEnabled)
  const [mainCategories, heroSlides, offers, categoryShowcase, topBrands, dealOfTheDay, freeShippingThreshold] = await Promise.all([
    needs.mainCategories ? getMainCategories() : Promise.resolve([]),
    needs.heroSlides ? getHeroSlides() : Promise.resolve([]),
    needs.offerSlider
      ? (pickedOfferIds.length > 0 ? listOffersByIds(pickedOfferIds) : listActiveOffers())
      : Promise.resolve([]),
    needs.categoryShowcase ? getCategoryShowcase() : Promise.resolve([]),
    needs.topBrands ? getTopBrands() : Promise.resolve([]),
    needs.dealOfTheDay ? getDealOfTheDay(gstEnabled) : Promise.resolve([]),
    needs.freeShippingThreshold ? getFreeShippingThreshold() : Promise.resolve(0),
  ])

  // One query per distinct row config, then fanned back out to the sections that share it.
  const rowResults = await Promise.all(
    [...rowPlan.entries()].map(async ([key, plan]) => {
      const products = await getProductsForSource(plan.source, plan.limit, plan.categorySlug, gstEnabled)
      return [key, products] as const
    })
  )
  const rowsByKey = new Map(rowResults)
  const extras = await extrasPromise
  const productRows = new Map<string, any[]>()
  for (const s of sections) {
    if (s.type !== 'product_row') continue
    productRows.set(s.id, rowsByKey.get(productRowKey(s, sectionLimit(s, 8))) ?? [])
  }

  const host = await getHost()
  const isLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|$)/.test(host) || /\.local(:|$)/.test(host)
  const businessOrigin = isLocal ? '' : 'https://business.jeffistores.in'
  const businessLandingUrl = isLocal ? '/business' : `${businessOrigin}/`
  const businessSignupUrl = isLocal ? '/business/signup' : `${businessOrigin}/signup`

  return (
    <div className="bg-surface">
      {sections.map((section, i) => (
        <SectionRenderer
          key={section.id}
          section={section}
          rowIndex={sections.slice(0, i).filter(s => s.type === 'product_row').length}
          data={{
            heroSlides,
            offers,
            mainCategories,
            topBrands,
            categoryShowcase,
            dealOfTheDay,
            productRows,
            freeShippingThreshold,
            gstEnabled,
            stats,
            aboutCopy,
            storeName: identity.name,
            businessLandingUrl,
            businessSignupUrl,
            extras,
          }}
        />
      ))}

      <ReviewCouponPopup />
    </div>
  )
}
