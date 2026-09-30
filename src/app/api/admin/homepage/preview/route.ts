import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany } from '@/lib/db'
import { buildProductRowSql } from '@/lib/homepage-data'
import {
  productSource,
  sectionLimit,
  resolveAboutStats,
  configId,
  friendlyCount,
  safeHref,
  SECTION_TYPES,
  SECTION_COPY_DEFAULTS,
  type SectionType,
  type HomepageSection,
  type PreviewItem,
} from '@/lib/homepage-sections'
import {
  getBackInStock,
  getBundles,
  getCategoryTabs,
  getCountdownDeal,
  getTestimonials,
  getValueStats,
} from '@/lib/homepage-extras'
import {
  VARIANT_MIN_PRICE_INCL_GST_SQL,
  VARIANT_MIN_PRICE_EX_GST_SQL,
  VARIANT_MIN_MRP_SQL,
  VARIANT_STOCK_TOTAL_SQL,
} from '@/lib/queries'
import { getFeatureFlags, getStorefrontContent } from '@/lib/site-controls'
import { getEditableHomepage } from '@/lib/homepage-draft'
import { listActiveOffers, listOffersByIds } from '@/lib/product-offers'

export const dynamic = 'force-dynamic'

const PREVIEW_LIMIT = 8

type PreviewKind =
  'products' | 'categories' | 'brands' | 'hero' | 'offers' | 'about' | 'reviews' | 'links' | 'stats' | 'none'

interface PreviewResult {
  kind: PreviewKind
  items: PreviewItem[]
  /** Shown instead of the tiles when there is nothing to draw, e.g. per-visitor or unconfigured sections. */
  note?: string
}

const querySchema = z.object({
  type: z.enum(SECTION_TYPES as [string, ...string[]]),
  config: z.string().max(8000).optional(),
})

function parseConfig(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function firstImage(row: { product_images?: unknown }): string | null {
  const imgs = row.product_images
  if (Array.isArray(imgs) && imgs.length > 0) {
    const first = imgs[0] as { image_url?: string | null; thumbnail_url?: string | null }
    return first?.thumbnail_url ?? first?.image_url ?? null
  }
  return null
}

async function productRow(config: Record<string, unknown>): Promise<PreviewItem[]> {
  const { gstEnabled } = await getFeatureFlags()
  const shape = { type: 'product_row', config } as Pick<HomepageSection, 'type' | 'config'>
  const source = productSource(shape)
  const categorySlug = typeof config.categorySlug === 'string' ? config.categorySlug : null
  const limit = Math.min(sectionLimit(shape, PREVIEW_LIMIT), PREVIEW_LIMIT)
  const sql = buildProductRowSql(source, categorySlug, {
    minPriceSql: gstEnabled ? VARIANT_MIN_PRICE_INCL_GST_SQL : VARIANT_MIN_PRICE_EX_GST_SQL,
    variantStockTotalSql: VARIANT_STOCK_TOTAL_SQL,
    variantMinMrpSql: VARIANT_MIN_MRP_SQL,
    totalSoldSql: `COALESCE((SELECT SUM(oi.quantity) FROM order_items oi WHERE oi.product_id = p.id), 0)`,
  })
  const params: unknown[] = [limit]
  if (source === 'category' && categorySlug) params.push(categorySlug)
  const rows = await queryMany<{
    id: string
    name: string
    variant_min_price: number | null
    product_images?: unknown
  }>(sql, params)
  return rows.map(r => ({ id: r.id, name: r.name, image_url: firstImage(r), price: r.variant_min_price }))
}

async function dealOfTheDay(): Promise<PreviewItem[]> {
  const rows = await queryMany<{ id: string; name: string; product_images?: unknown }>(`
    SELECT p.id, p.name,
      COALESCE(
        (SELECT json_agg(pi ORDER BY pi.display_order)
         FROM product_images pi WHERE pi.product_id = p.id),
        '[]'::json
      ) AS product_images
    FROM products p
    WHERE p.is_active = true AND p.is_featured = true
    ORDER BY RANDOM()
    LIMIT 4
  `)
  return rows.map(r => ({ id: r.id, name: r.name, image_url: firstImage(r) }))
}

// Mirrors the storefront's getMainCategories: every top-level category, drawn as an icon.
async function mainCategories(): Promise<PreviewItem[]> {
  const rows = await queryMany<{ id: string; name: string }>(`
    SELECT id, name FROM categories
    WHERE parent_category_id IS NULL AND is_active = true
    ORDER BY display_order ASC
    LIMIT 24
  `)
  return rows.map(r => ({ id: r.id, name: r.name, image_url: null }))
}

// Mirrors the storefront's getCategoryShowcase: the four busiest top-level categories, each shown
// with its lead product's photo (featured first, then newest).
async function showcaseCategories(): Promise<PreviewItem[]> {
  const rows = await queryMany<{ id: string; name: string; image_url: string | null }>(`
    SELECT c.id, c.name,
      (SELECT COALESCE(pi.thumbnail_url, pi.image_url)
         FROM products p2
         JOIN categories s2 ON s2.id = p2.category_id AND s2.parent_category_id = c.id
         JOIN product_images pi ON pi.product_id = p2.id
        WHERE p2.is_active = true
        ORDER BY p2.is_featured DESC, p2.created_at DESC, pi.display_order ASC
        LIMIT 1) AS image_url
    FROM categories c
    JOIN categories sub ON sub.parent_category_id = c.id
    JOIN products p ON p.category_id = sub.id AND p.is_active = true
    WHERE c.parent_category_id IS NULL AND c.is_active = true
    GROUP BY c.id, c.name
    HAVING COUNT(p.id) >= 2
    ORDER BY COUNT(p.id) DESC
    LIMIT 4
  `)
  return rows.map(r => ({ id: r.id, name: r.name, image_url: r.image_url }))
}

// Mirrors the storefront's getTopBrands; brands render as initials there, so no image.
async function topBrands(): Promise<PreviewItem[]> {
  const rows = await queryMany<{ id: string; name: string }>(`
    SELECT b.id, b.name
    FROM brands b
    JOIN products p ON p.brand_id = b.id AND p.is_active = true
    GROUP BY b.id, b.name
    HAVING COUNT(p.id) >= 2
    ORDER BY COUNT(p.id) DESC
    LIMIT 8
  `)
  return rows.map(r => ({ id: r.id, name: r.name, image_url: null }))
}

async function heroItems(): Promise<PreviewItem[]> {
  const { heroSlides } = await getEditableHomepage()
  return heroSlides
    .filter(s => s.is_active)
    .slice(0, PREVIEW_LIMIT)
    .map(s => ({
      id: s.id,
      name: s.title || 'Slide',
      image_url: s.image_url,
    }))
}

async function offerItems(config: Record<string, unknown>): Promise<PreviewItem[]> {
  const rawIds = config.offerIds
  const ids = Array.isArray(rawIds) ? rawIds.filter((v): v is string => typeof v === 'string') : []
  const offers = ids.length > 0 ? await listOffersByIds(ids) : await listActiveOffers()
  return offers.slice(0, PREVIEW_LIMIT).map(o => ({
    id: o.id,
    name: o.title,
    image_url: o.image_url,
  }))
}

const isStat = (s: unknown): s is { value: string; label: string } =>
  !!s &&
  typeof s === 'object' &&
  typeof (s as Record<string, unknown>).value === 'string' &&
  typeof (s as Record<string, unknown>).label === 'string'

// The About photo followed by its stat tiles, resolved the way the storefront resolves them.
async function aboutItems(config: Record<string, unknown>): Promise<PreviewItem[]> {
  const imageUrl =
    typeof config.imageUrl === 'string' && config.imageUrl ? config.imageUrl : SECTION_COPY_DEFAULTS.about.imageUrl
  const own = Array.isArray(config.stats) ? config.stats.filter(isStat) : []
  const stats = own.length > 0 ? own : resolveAboutStats((await getStorefrontContent()).statsJson)
  return [
    { id: 'photo', name: 'Photo', image_url: imageUrl },
    ...stats.map((s, i) => ({ id: `stat-${i}`, name: s.label, image_url: null, value: s.value })),
  ]
}

const productItem = (r: {
  id: string
  name: string
  variant_min_price?: number | null
  product_images?: unknown
}): PreviewItem => ({ id: r.id, name: r.name, image_url: firstImage(r), price: r.variant_min_price ?? null })

const shape = (type: SectionType, config: Record<string, unknown>) => ({ type, config })

async function countdownDeal(config: Record<string, unknown>): Promise<PreviewResult> {
  if (!configId({ config }, 'productId'))
    return { kind: 'products', items: [], note: 'Pick a deal product to preview this banner.' }
  const { gstEnabled } = await getFeatureFlags()
  const deal = await getCountdownDeal(shape('countdown_deal', config), gstEnabled)
  return deal
    ? { kind: 'products', items: [productItem(deal.product)] }
    : {
        kind: 'products',
        items: [],
        note: 'The countdown has ended or the product is no longer live, so this banner is hidden.',
      }
}

async function withGst<T>(load: (gstEnabled: boolean) => Promise<T>): Promise<T> {
  return load((await getFeatureFlags()).gstEnabled)
}

function tileItems(config: Record<string, unknown>, titleKey: string, fallback: string): PreviewItem[] {
  const raw = Array.isArray(config.items) ? config.items : []
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .filter(r => typeof r.url === 'string' && safeHref(r.url))
    .slice(0, PREVIEW_LIMIT)
    .map((r, i) => ({
      id: `item-${i}`,
      name: typeof r[titleKey] === 'string' && (r[titleKey] as string).trim() ? (r[titleKey] as string) : fallback,
      image_url: typeof r.imageUrl === 'string' ? safeHref(r.imageUrl) : null,
    }))
}

const RESOLVERS: Partial<Record<SectionType, (config: Record<string, unknown>) => Promise<PreviewResult>>> = {
  product_row: async c => ({ kind: 'products', items: await productRow(c) }),
  featured_for_you: async () => ({ kind: 'products', items: await productRow({ source: 'featured' }) }),
  deal_of_the_day: async () => ({ kind: 'products', items: await dealOfTheDay() }),
  category_grid: async () => ({ kind: 'categories', items: await mainCategories() }),
  category_showcase: async () => ({ kind: 'categories', items: await showcaseCategories() }),
  brand_carousel: async () => ({ kind: 'brands', items: await topBrands() }),
  hero: async () => ({ kind: 'hero', items: await heroItems() }),
  offer_slider: async c => ({ kind: 'offers', items: await offerItems(c) }),
  about: async c => ({ kind: 'about', items: await aboutItems(c) }),
  countdown_deal: countdownDeal,
  testimonials: async c => ({
    kind: 'reviews',
    items: (await getTestimonials(shape('testimonials', c))).map(t => ({
      id: t.id,
      name: t.author,
      image_url: null,
      value: `${t.rating}/5`,
    })),
  }),
  recently_viewed: async () => ({
    kind: 'none',
    items: [],
    note: 'Each visitor sees their own recently viewed products, saved on their device, so there is nothing to preview.',
  }),
  category_tabs: async c => ({
    kind: 'categories',
    items: (await withGst(gst => getCategoryTabs(shape('category_tabs', c), gst))).map(t => ({
      id: t.id,
      name: `${t.name} · ${t.products.length}`,
      image_url: firstImage(t.products[0] ?? {}),
    })),
  }),
  bundle_spotlight: async c => ({
    kind: 'products',
    items: (await withGst(gst => getBundles(shape('bundle_spotlight', c), gst)))
      .slice(0, PREVIEW_LIMIT)
      .map(productItem),
  }),
  back_in_stock: async c => ({
    kind: 'products',
    items: (await withGst(gst => getBackInStock(shape('back_in_stock', c), gst)))
      .slice(0, PREVIEW_LIMIT)
      .map(productItem),
  }),
  blog_teaser: async c => ({ kind: 'links', items: tileItems(c, 'title', 'Article') }),
  social_strip: async c => ({ kind: 'links', items: tileItems(c, 'caption', 'Post') }),
  value_stats: async c => ({
    kind: 'stats',
    items: (await getValueStats(shape('value_stats', c))).map(s => ({
      id: s.metric,
      name: s.label,
      image_url: null,
      value: friendlyCount(s.value),
    })),
  }),
}

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'settings:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const parsed = querySchema.safeParse({
    type: searchParams.get('type') ?? undefined,
    config: searchParams.get('config') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid preview request' }, { status: 400 })
  }

  const type = parsed.data.type as SectionType
  const resolver = RESOLVERS[type]
  if (!resolver) return NextResponse.json({ kind: 'none', items: [] })

  const config = parseConfig(parsed.data.config)
  try {
    const { kind, items, note } = await resolver(config)
    return NextResponse.json({ kind, items, ...(note ? { note } : {}) })
  } catch (err) {
    console.error('[homepage-preview]', type, err)
    return NextResponse.json({ error: 'Preview failed' }, { status: 500 })
  }
}
