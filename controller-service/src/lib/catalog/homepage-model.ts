import { queryMany } from '@/lib/shared/db'
import { heroSlideHref } from '@/lib/catalog/hero-slides'
import {
  VARIANT_MIN_PRICE_INCL_GST_SQL,
  VARIANT_MIN_PRICE_EX_GST_SQL,
  VARIANT_MIN_MRP_SQL,
  VARIANT_STOCK_TOTAL_SQL,
} from '@/lib/queries'
import { getHost } from '@/lib/tenancy/get-host'
import { getStorefrontContent, getFeatureFlags, getStoreIdentity } from '@/lib/catalog/site-controls'
import {
  SURFACE_COLUMN_SQL,
  getConfiguredSections,
  buildProductRowSql,
  planDataNeeds,
  planProductRows,
} from '@/lib/catalog/homepage-data'
import { loadSectionExtras } from '@/lib/catalog/homepage-extras'
import {
  forSurface,
  productRowKey,
  sectionLimit,
  defaultAboutCopy,
  resolveAboutStats,
  sectionCopyDefaults,
  sectionLayout,
  safeHref,
  justLandedDays,
  launchedWithin,
  motionHeroIntervalMs,
  motionHeroSlides,
  rewardsGamePublic,
  spotlightConfig,
  storyGroups,
  LEGACY_APP_HIDDEN_TYPES,
  SECTION_TILE_DEFAULTS,
  type HomepageSection,
  type HomepageSurface,
  type ProductSource,
  type SectionCopy,
  type SectionLayout,
  type SectionType,
} from '@/lib/catalog/homepage-sections'
import { listActiveOffers, listOffersByIds } from '@/lib/catalog/product-offers'
import { cardPropsFor, type CardProps } from '@/lib/catalog/product-card-props'
import type { CategoryTab, CountdownDealData, SpotlightData } from '@/lib/catalog/homepage-extras'
import type { ProductOffer } from '@/lib/catalog/product-offers-shared'

/** What each home section reads (SectionRenderer's data prop). */
export interface SectionData {
  heroSlides: any[]
  offers: ProductOffer[]
  mainCategories: any[]
  topBrands: any[]
  categoryShowcase: any[]
  dealOfTheDay: any[]
  productRows: Map<string, any[]>
  freeShippingThreshold: number
  gstEnabled: boolean
  stats: { value: string; label: string }[]
  aboutCopy: string
  storeName: string
  businessLandingUrl: string
  businessSignupUrl: string
  /** Per-section data for the section types that load their own (loadSectionExtras). */
  extras: Map<string, unknown>
}

export interface HomeModel {
  sections: HomepageSection[]
  data: SectionData
}

// One SELECT list for featured / new-arrivals / best-sellers; only WHERE and ORDER BY differ.
async function getProductsForSource(
  source: ProductSource,
  limit: number,
  categorySlug: string | null,
  gstEnabled: boolean
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

async function getHeroSlides(surface: HomepageSurface) {
  // Admin-managed hero_slides first; each carries its own copy, image and CTA link. Active is
  // filtered after the surface is picked so an app with only paused slides doesn't borrow the web's.
  const slides = await queryMany<any>(
    `SELECT id, title, subtitle, badge_text, badge_color, image_url, image_url_mobile, blurhash, blurhash_mobile,
            cta_url, filter_category, filter_brand, filter_grade, filter_material, filter_min_price,
            filter_max_price, filter_in_stock, filter_on_sale, is_active, ${SURFACE_COLUMN_SQL('h')}
       FROM hero_slides h ORDER BY display_order ASC, created_at ASC`
  )
  const managed = forSurface(slides, surface).filter(s => s.is_active)
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

  // Legacy fallback: 4 parent categories, shuffled deterministically per day.
  const all = await queryMany<{
    name: string
    slug: string
    hero_image_mobile: string | null
    hero_image_desktop: string | null
  }>(`
    SELECT name, slug, hero_image_mobile, hero_image_desktop
    FROM categories
    WHERE parent_category_id IS NULL AND is_active = true
    ORDER BY display_order ASC
  `)

  const daySeed = Math.floor(Date.now() / 86_400_000)
  function mulberry32(seed: number) {
    return () => {
      seed |= 0
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  const rng = mulberry32(daySeed)
  const shuffled = [...all]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
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
  // Same setting checkout/shipping uses, so the homepage matches the real threshold.
  const { getDeliverySettings } = await import('@/lib/shipping/delivery-settings')
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
  const result = await Promise.all(
    categories.map(async cat => {
      const products = await queryMany(
        `
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
    `,
        [cat.id]
      )
      return { ...cat, products }
    })
  )
  return result.filter(c => c.products.length >= 2)
}

/** Everything the storefront home renders: the configured sections plus the data each one needs. */
export async function buildHomeModel({
  surface = 'web',
  legacyClient = false,
}: {
  surface?: HomepageSurface
  /** An app build from before per-surface layouts: it gets the website layout minus the types it can't render. */
  legacyClient?: boolean
} = {}): Promise<HomeModel> {
  const storefront = await getStorefrontContent()
  const { gstEnabled } = await getFeatureFlags()

  const stats = resolveAboutStats(storefront.statsJson)
  // Flagship copy is withheld from tenants; an unset value means a tenant that hasn't written one.
  const identity = await getStoreIdentity()
  const aboutCopy = defaultAboutCopy(storefront.aboutCopy, identity.name)

  const allSections = await getConfiguredSections(surface)
  // The Business CTA promotes the B2B portal, which only exists on plans that sell it (Pro+); the
  // rewards game issues coupons, a customer-programs feature on the same footing.
  const { currentTenantPlanGate } = await import('@/lib/auth/plan-gate')
  const businessAllowed = (await currentTenantPlanGate('business_customers:read').catch(() => ({ allowed: false }))).allowed
  const programsAllowed = allSections.some(s => s.type === 'rewards_game')
    ? await (await import('@/lib/loyalty/settings')).customerProgramsAllowed()
    : false
  const sections = allSections.filter(
    s =>
      (businessAllowed || s.type !== 'business_cta') &&
      (programsAllowed || s.type !== 'rewards_game') &&
      !(legacyClient && LEGACY_APP_HIDDEN_TYPES.has(s.type))
  )
  const needs = planDataNeeds(sections, surface)
  const rowPlan = planProductRows(sections)

  // Honor the offer-slider section's picked offers (config.offerIds); fall back to all active.
  const offerSection = sections.find(s => s.type === 'offer_slider')
  const rawOfferIds = offerSection?.config?.offerIds
  const pickedOfferIds = Array.isArray(rawOfferIds)
    ? rawOfferIds.filter((id): id is string => typeof id === 'string')
    : []

  const extrasPromise = loadSectionExtras(sections, gstEnabled)
  const [mainCategories, heroSlides, offers, categoryShowcase, topBrands, dealOfTheDay, freeShippingThreshold] =
    await Promise.all([
      needs.mainCategories ? getMainCategories() : Promise.resolve([]),
      needs.heroSlides ? getHeroSlides(surface) : Promise.resolve([]),
      needs.offerSlider
        ? pickedOfferIds.length > 0
          ? listOffersByIds(pickedOfferIds)
          : listActiveOffers()
        : Promise.resolve([]),
      needs.categoryShowcase ? getCategoryShowcase() : Promise.resolve([]),
      needs.topBrands ? getTopBrands() : Promise.resolve([]),
      needs.dealOfTheDay ? getDealOfTheDay(gstEnabled) : Promise.resolve([]),
      needs.freeShippingThreshold ? getFreeShippingThreshold() : Promise.resolve(0),
    ])

  // One query per distinct row config, fanned back out to the sections that share it.
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
  // THIS tenant's business portal ({slug}.business.<root>), not the flagship's.
  const { businessHostForHost } = await import('@/lib/tenancy/forms-host')
  const businessOrigin = isLocal ? '' : `https://${businessHostForHost(host)}`
  const businessLandingUrl = isLocal ? '/business' : `${businessOrigin}/`
  const businessSignupUrl = isLocal ? '/business/signup' : `${businessOrigin}/signup`

  return {
    sections,
    data: {
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
    },
  }
}

/** A card plus the row badge the web derives from the raw row ("New", "Bundle", "Back in stock"). */
export type HomeCard = CardProps & { badge: string | null }

/** A section as the app reads it: copy defaults filled in, tiles validated (or the built-in ones). */
export type HomeSectionJson = HomepageSection & {
  layout: SectionLayout
  copy: SectionCopy
  items: Record<string, string>[] | null
}

/**
 * GET /api/home body for the app. Maps become objects and every product list is reduced to card
 * props: the raw rows carry internal columns (cost_price, supplier_id, storage keys).
 */
export interface HomeModelJson {
  sections: HomeSectionJson[]
  data: Omit<SectionData, 'productRows' | 'extras' | 'dealOfTheDay' | 'categoryShowcase'> & {
    productRows: Record<string, HomeCard[]>
    dealOfTheDay: HomeCard[]
    categoryShowcase: { id: string; name: string; slug: string; products: HomeCard[] }[]
    extras: Record<string, unknown>
  }
}

const TILE_KEYS: Partial<Record<SectionType, string[]>> = {
  trust_strip: ['icon', 'label'],
  benefits: ['icon', 'title', 'sub'],
  why_us: ['icon', 'title', 'desc', 'color'],
  blog_teaser: ['title', 'excerpt', 'url', 'imageUrl'],
  social_strip: ['imageUrl', 'url', 'caption'],
}

// Same rule as SectionRenderer's tiles(): admin jsonb rows missing a key are dropped.
function validTiles(raw: unknown, keys: string[]): Record<string, string>[] | null {
  if (!Array.isArray(raw)) return null
  const rows = raw.filter(r => !!r && typeof r === 'object' && keys.every(k => typeof (r as any)[k] === 'string'))
  return rows.length > 0 ? (rows as Record<string, string>[]) : null
}

function sectionItems(s: HomepageSection, data: SectionData): Record<string, string>[] | null {
  const cfg = s.config ?? {}
  if (s.type === 'about') return validTiles(cfg.stats, ['value', 'label']) ?? data.stats
  const keys = TILE_KEYS[s.type]
  if (!keys) return null
  let rows = validTiles(cfg.items, keys)
  if (s.type === 'blog_teaser' || s.type === 'social_strip') {
    rows = (rows ?? [])
      .map(i => ({ ...i, url: safeHref(i.url) ?? '', imageUrl: safeHref(i.imageUrl) ?? '' }))
      .filter(i => i.url && (s.type === 'social_strip' ? i.imageUrl : (i as Record<string, string>).title?.trim()))
    return rows.length ? rows : null
  }
  return rows ?? (SECTION_TILE_DEFAULTS as Partial<Record<SectionType, Record<string, string>[]>>)[s.type] ?? null
}

export function toHomeModelJson({ sections, data }: HomeModel): HomeModelJson {
  const cards = (rows: any[], badgeFor?: (row: any) => string | null): HomeCard[] =>
    cardPropsFor(rows, data.gstEnabled).map((c, i) => ({ ...c, badge: badgeFor?.(rows[i]) ?? null }))
  const extras: Record<string, unknown> = {}
  const productRows: Record<string, HomeCard[]> = {}
  for (const s of sections) {
    if (s.type === 'product_row') {
      const days = justLandedDays(s)
      productRows[s.id] = cards(data.productRows.get(s.id) ?? [], days ? r => (launchedWithin(r, days) ? 'New' : null) : undefined)
    }
    if (!data.extras.has(s.id)) continue
    const value = data.extras.get(s.id)
    switch (s.type) {
      case 'countdown_deal': {
        const deal = value as CountdownDealData | null
        extras[s.id] = deal ? { ...deal, product: cards([deal.product])[0] } : null
        break
      }
      case 'category_tabs':
        extras[s.id] = (value as CategoryTab[]).map(t => ({ ...t, products: cards(t.products) }))
        break
      case 'bundle_spotlight':
        extras[s.id] = cards(value as any[], r => (r.is_bundle ? 'Bundle' : null))
        break
      case 'back_in_stock':
        extras[s.id] = cards(value as any[], () => 'Back in stock')
        break
      case 'product_spotlight': {
        const spot = value as SpotlightData | null
        const { headline, callouts } = spotlightConfig(s)
        extras[s.id] = spot ? { product: cards([spot.product])[0], headline, callouts } : null
        break
      }
      default:
        extras[s.id] = value
    }
  }
  // Config-only sections: the app reads the validated shape instead of raw admin JSON.
  for (const s of sections) {
    if (s.type === 'motion_hero') extras[s.id] = { slides: motionHeroSlides(s), intervalMs: motionHeroIntervalMs(s) }
    if (s.type === 'stories') extras[s.id] = { groups: storyGroups(s) }
    if (s.type === 'rewards_game') extras[s.id] = rewardsGamePublic(s)
  }
  const sectionsJson: HomeSectionJson[] = sections.map(s => {
    const d = sectionCopyDefaults(s.type)
    return {
      ...s,
      layout: sectionLayout(s),
      copy: {
        eyebrow: s.eyebrow ?? d.eyebrow,
        title: s.title ?? d.title,
        subtitle: (s.type === 'about' ? s.subtitle || data.aboutCopy : s.subtitle) ?? d.subtitle,
        body: (typeof s.config?.body === 'string' ? s.config.body : null) ?? d.body,
        imageUrl: (typeof s.config?.imageUrl === 'string' ? s.config.imageUrl : null) ?? d.imageUrl,
        ctaLabel: s.cta_label ?? d.ctaLabel,
        ctaUrl: s.cta_url ?? d.ctaUrl,
      },
      items: sectionItems(s, data),
    }
  })
  return {
    sections: sectionsJson,
    data: {
      ...data,
      productRows,
      dealOfTheDay: cards(data.dealOfTheDay),
      categoryShowcase: data.categoryShowcase.map((c: any) => ({ id: c.id, name: c.name, slug: c.slug, products: cards(c.products) })),
      extras,
    },
  }
}
