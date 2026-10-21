import { queryMany, queryOne } from '@/lib/shared/db'
import { VARIANT_MIN_PRICE_INCL_GST_SQL, VARIANT_MIN_PRICE_EX_GST_SQL } from '@/lib/queries'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { buildProductSearchClause, buildProductSearchRank } from '@/lib/catalog/search'
import { buildProductFilterClauses, getFilterFacets, type FilterFacets } from '@/lib/catalog/product-filters'
import { getOfferBySlug, listActiveOffers, listFilterOffers } from '@/lib/catalog/product-offers'
import { pickPromoOffer, type ProductOffer, type PromoOffer } from '@/lib/catalog/product-offers-shared'
import { cardPropsFor, type CardProps } from '@/lib/catalog/product-card-props'
import { pickUnitPrice } from '@/lib/catalog/pricing'
import { round2 } from '@/lib/catalog/gst'

// The storefront /products listing: everything app/(storefront)/products/page.tsx reads before it
// renders, built once for the page and for GET /api/products/listing (the mobile app).

export const LISTING_PAGE_SIZE = 60
const PAGE_SIZE = LISTING_PAGE_SIZE

export type ListingSearchParams = { [key: string]: string | undefined }

function buildListingConditions(searchParams: any) {
  const conditions: string[] = ['p.is_active = true']
  const params: any[] = []
  let paramIndex = 1

  if (searchParams.category) {
    const catVals = String(searchParams.category).split(',').filter(Boolean)
    if (catVals.length === 1) {
      conditions.push(`p.category_id IN (
        WITH RECURSIVE cat_tree AS (
          SELECT id FROM categories WHERE id::text = $${paramIndex} OR slug = $${paramIndex}
          UNION ALL
          SELECT c.id FROM categories c JOIN cat_tree ct ON c.parent_category_id = ct.id
        )
        SELECT id FROM cat_tree
      )`)
      params.push(catVals[0])
      paramIndex++
    } else {
      const parts = catVals.map(() => {
        const p = paramIndex++
        return `(id::text = $${p} OR slug = $${p})`
      })
      conditions.push(`p.category_id IN (SELECT id FROM categories WHERE ${parts.join(' OR ')})`)
      params.push(...catVals)
    }
  }

  if (searchParams.brand) {
    const brandVals = String(searchParams.brand).split(',').filter(Boolean)
    const parts = brandVals.map(() => {
      const p = paramIndex++
      return `(id::text = $${p} OR slug = $${p})`
    })
    conditions.push(`p.brand_id IN (SELECT id FROM brands WHERE ${parts.join(' OR ')})`)
    params.push(...brandVals)
  }

  const filterClauses = buildProductFilterClauses(searchParams, paramIndex)
  conditions.push(...filterClauses.conditions)
  params.push(...filterClauses.params)
  paramIndex = filterClauses.nextIdx

  if (searchParams.search) {
    const sc = buildProductSearchClause(searchParams.search, 'p.name', 'p.sku', 'p.search_vector', paramIndex)
    conditions.push(sc.clause)
    params.push(...sc.params)
    paramIndex = sc.nextIdx
  }

  return { conditions, params, paramIndex }
}

async function getProducts(searchParams: any) {
  const { conditions, params, paramIndex } = buildListingConditions(searchParams)

  const sortBy = searchParams.sort || 'created_at'
  const sortOrder = searchParams.order === 'asc' ? 'ASC' : 'DESC'

  const allowedSortColumns: Record<string, string> = {
    created_at: 'p.created_at',
    name: 'p.name',
    category: 'c.name, p.name', // group-by-category sort
    base_price: `CASE WHEN p.has_variants THEN (
      SELECT MIN(price) FROM (
        SELECT pv2.price FROM product_variants pv2
        WHERE pv2.product_id = p.id AND pv2.is_active = true AND pv2.price IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM product_sub_variants sv2 WHERE sv2.variant_id = pv2.id AND sv2.is_active = true)
        UNION ALL
        SELECT sv2.price FROM product_sub_variants sv2
        JOIN product_variants pv2 ON pv2.id = sv2.variant_id
        WHERE pv2.product_id = p.id AND pv2.is_active = true AND sv2.is_active = true AND sv2.price IS NOT NULL
      ) AS ep
    ) ELSE COALESCE(p.price_ex_gst, p.base_price) END`,
    price: `CASE WHEN p.has_variants THEN (
      SELECT MIN(price) FROM (
        SELECT pv2.price FROM product_variants pv2
        WHERE pv2.product_id = p.id AND pv2.is_active = true AND pv2.price IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM product_sub_variants sv2 WHERE sv2.variant_id = pv2.id AND sv2.is_active = true)
        UNION ALL
        SELECT sv2.price FROM product_sub_variants sv2
        JOIN product_variants pv2 ON pv2.id = sv2.variant_id
        WHERE pv2.product_id = p.id AND pv2.is_active = true AND sv2.is_active = true AND sv2.price IS NOT NULL
      ) AS ep
    ) ELSE COALESCE(p.price_ex_gst, p.base_price) END`,
  }
  const sortColumn = allowedSortColumns[sortBy] || 'p.created_at'
  const hasExplicitSort = !!searchParams.sort

  const whereClause = conditions.join(' AND ')

  const countRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*) AS total FROM products p WHERE ${whereClause}`,
    params
  )
  const total = Number(countRow?.total ?? 0)

  const page = Math.max(1, parseInt(searchParams.page || '1', 10))
  const offset = (page - 1) * PAGE_SIZE

  // Relevance ranking for search. buildProductSearchRank needs its own bound
  // params, which are appended AFTER the clause params (the count query above
  // used only the clause params, so its placeholder numbering is unaffected).
  const rankParams: unknown[] = []
  let orderBy: string
  if (hasExplicitSort) {
    orderBy = `${sortColumn} ${sortOrder}`
  } else if (searchParams.search) {
    const rk = buildProductSearchRank(searchParams.search, 'p.name', 'p.search_vector', paramIndex)
    rankParams.push(...rk.params)
    orderBy = `${rk.rank}, p.name ASC`
  } else {
    orderBy = `p.is_featured DESC, COALESCE(pc.display_order, c.display_order, 9999) ASC, c.display_order ASC, p.created_at DESC`
  }

  const { gstEnabled } = await getFeatureFlags()
  const MIN_PRICE_SQL = gstEnabled ? VARIANT_MIN_PRICE_INCL_GST_SQL : VARIANT_MIN_PRICE_EX_GST_SQL

  const sql = `
    SELECT p.*,
      json_build_object('id', c.id, 'name', c.name, 'slug', c.slug) AS categories,
      json_build_object('id', b.id, 'name', b.name) AS brands,
      COALESCE(
        (SELECT json_agg(pi ORDER BY pi.display_order)
         FROM product_images pi WHERE pi.product_id = p.id),
        '[]'::json
      ) AS product_images,
      COALESCE((SELECT COUNT(CASE WHEN pv.stock_status != 'Out of Stock' THEN 1 END)
      FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true), 0) AS variant_stock_total,
      ${MIN_PRICE_SQL} AS variant_min_price,
      (SELECT MIN(mrp) FROM (
        SELECT pv.mrp
        FROM product_variants pv
        WHERE pv.product_id = p.id AND pv.is_active = true AND pv.mrp IS NOT NULL AND pv.mrp > 0
          AND NOT EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
        UNION ALL
        SELECT sv.mrp
        FROM product_sub_variants sv
        JOIN product_variants pv ON pv.id = sv.variant_id
        WHERE pv.product_id = p.id AND pv.is_active = true AND sv.is_active = true AND sv.mrp IS NOT NULL AND sv.mrp > 0
      ) AS combined_mrps) AS variant_min_mrp
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN categories pc ON c.parent_category_id = pc.id
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE ${whereClause}
    ORDER BY ${orderBy}
    LIMIT ${PAGE_SIZE} OFFSET ${offset}
  `

  const products = await queryMany(sql, [...params, ...rankParams])
  return { products, total, page, totalPages: Math.ceil(total / PAGE_SIZE), gstEnabled }
}

async function getCategories() {
  return queryMany(`
    SELECT c.id, c.name, c.slug, c.parent_category_id, c.display_order
    FROM categories c
    WHERE c.is_active = true
      AND (
        EXISTS (SELECT 1 FROM products p WHERE p.category_id = c.id AND p.is_active = true)
        OR EXISTS (
          SELECT 1 FROM products p
          JOIN categories child ON p.category_id = child.id
          WHERE child.parent_category_id = c.id AND p.is_active = true
        )
      )
    ORDER BY c.display_order ASC
  `)
}

async function getBrands() {
  return queryMany(`
    SELECT b.id, b.name
    FROM brands b
    WHERE b.is_active = true
      AND EXISTS (SELECT 1 FROM products p WHERE p.brand_id = b.id AND p.is_active = true)
    ORDER BY b.name ASC
  `)
}

async function getCategoryBanners(gstEnabled: boolean) {
  const cats = await queryMany<{ id: string; name: string; slug: string }>(`
    SELECT c.id, c.name, c.slug FROM categories c
    WHERE c.parent_category_id IS NULL AND c.is_active = true
      AND EXISTS (
        SELECT 1 FROM products p
        JOIN categories sub ON p.category_id = sub.id
        WHERE sub.parent_category_id = c.id AND p.is_active = true
      )
    ORDER BY c.display_order ASC LIMIT 6
  `)
  const withProducts = await Promise.all(
    cats.map(async cat => {
      const products = await queryMany<any>(
        `
      SELECT p.id, p.name, p.slug, p.has_variants, p.base_price, p.price_ex_gst,
        MIN(pv.price) FILTER (WHERE pv.is_active) AS variant_min_price,
        (SELECT json_agg(json_build_object('image_url', pi2.image_url, 'thumbnail_url', pi2.thumbnail_url))
           FROM product_images pi2 WHERE pi2.product_id = p.id LIMIT 1) AS product_images
      FROM products p
      JOIN categories sub ON p.category_id = sub.id AND sub.parent_category_id = $1
      LEFT JOIN product_variants pv ON pv.product_id = p.id
      WHERE p.is_active = true
      GROUP BY p.id ORDER BY p.is_featured DESC, p.created_at DESC LIMIT 12
    `,
        [cat.id]
      )
      return { ...cat, products }
    })
  )
  return withProducts.filter(c => c.products.length >= 2)
}

export interface ListingModel {
  products: any[]
  total: number
  page: number
  totalPages: number
  start: number
  end: number
  gstEnabled: boolean
  categories: any[]
  brands: any[]
  categoryBanners: any[]
  facets: FilterFacets
  /** Live offers holding products, plus the selected one if it has ended or emptied. */
  filterOffers: { slug: string; title: string }[]
  promoOffer: ProductOffer | null
}

export async function buildListingModel(resolvedSearchParams: ListingSearchParams): Promise<ListingModel> {
  const { products, total, page, totalPages, gstEnabled } = await getProducts(resolvedSearchParams)
  const [categories, brands] = await Promise.all([getCategories(), getBrands()])
  const categoryBanners = await getCategoryBanners(gstEnabled)

  // Facets are computed against the category+brand+search base only (not the
  // active scalar filters) so counts stay meaningful when toggling grade/material/etc.
  const facetBaseConditions: string[] = ['p.is_active = true']
  const facetBaseParams: any[] = []
  let facetIdx = 1
  if (resolvedSearchParams.category) {
    const catVals = String(resolvedSearchParams.category).split(',').filter(Boolean)
    if (catVals.length === 1) {
      facetBaseConditions.push(`p.category_id IN (
        WITH RECURSIVE cat_tree AS (
          SELECT id FROM categories WHERE id::text = $${facetIdx} OR slug = $${facetIdx}
          UNION ALL
          SELECT c.id FROM categories c JOIN cat_tree ct ON c.parent_category_id = ct.id
        )
        SELECT id FROM cat_tree
      )`)
      facetBaseParams.push(catVals[0])
      facetIdx++
    } else {
      const parts = catVals.map(() => {
        const p = facetIdx++
        return `(id::text = $${p} OR slug = $${p})`
      })
      facetBaseConditions.push(`p.category_id IN (SELECT id FROM categories WHERE ${parts.join(' OR ')})`)
      facetBaseParams.push(...catVals)
    }
  }
  if (resolvedSearchParams.brand) {
    const brandVals = String(resolvedSearchParams.brand).split(',').filter(Boolean)
    const parts = brandVals.map(() => {
      const p = facetIdx++
      return `(id::text = $${p} OR slug = $${p})`
    })
    facetBaseConditions.push(`p.brand_id IN (SELECT id FROM brands WHERE ${parts.join(' OR ')})`)
    facetBaseParams.push(...brandVals)
  }
  const facets = await getFilterFacets(facetBaseConditions, facetBaseParams)

  const [liveOffers, activeOffer, activeOffers] = await Promise.all([
    listFilterOffers(),
    resolvedSearchParams.offer ? getOfferBySlug(String(resolvedSearchParams.offer)) : Promise.resolve(null),
    listActiveOffers(),
  ])
  const promoOffer = pickPromoOffer(activeOffers, {
    page,
    activeSlug: resolvedSearchParams.offer ?? null,
    eligibleSlugs: new Set(liveOffers.map(o => o.slug)),
  })
  // A selected offer that has ended or emptied stays listed so the shopper can see and clear it.
  const filterOffers =
    activeOffer && !liveOffers.some(o => o.slug === activeOffer.slug)
      ? [...liveOffers, { slug: activeOffer.slug, title: activeOffer.title }]
      : liveOffers

  const start = (page - 1) * PAGE_SIZE + 1
  const end = Math.min(page * PAGE_SIZE, total)

  return {
    products: products as any[],
    total,
    page,
    totalPages,
    start,
    end,
    gstEnabled,
    categories: categories as any[],
    brands: brands as any[],
    categoryBanners: categoryBanners as any[],
    facets,
    filterOffers,
    promoOffer,
  }
}

/** A listing product as card props, plus the few row fields the listing's grouped and table views read. */
export interface ListingCard extends CardProps {
  categoryId: string | null
  categorySlug: string | null
  handlingDays: number
  stockStatus: string | null
  grade: string | null
  material: string | null
  finish: string | null
  complianceStandard: string | null
}

export interface ListingModelJson {
  products: ListingCard[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  start: number
  end: number
  gstEnabled: boolean
  categories: { id: string; name: string; slug: string; parent_category_id: string | null; display_order: number | null }[]
  brands: { id: string; name: string }[]
  categoryBanners: {
    id: string
    name: string
    slug: string
    products: { id: string; name: string; slug: string; displayPrice: number; image: { image_url: string; thumbnail_url: string | null } | null }[]
  }[]
  facets: FilterFacets
  offers: { slug: string; title: string }[]
  promoOffer: PromoOffer | null
}

/** The listing model as JSON for the app: products reduced to card props (never raw rows), the rest as plain data. */
export function toListingModelJson(m: ListingModel): ListingModelJson {
  const cards = cardPropsFor(m.products, m.gstEnabled)
  return {
    products: m.products.map((row, i) => {
      // renderProductItem: a variant product's MRP is its cheapest variant MRP, not the product MRP.
      const rawMrp = row.has_variants
        ? row.variant_min_mrp
          ? Number(row.variant_min_mrp)
          : null
        : row.mrp
          ? Number(row.mrp)
          : null
      const gstRate = Number(row.gst_percentage ?? 0)
      const mrp = !m.gstEnabled && rawMrp != null && gstRate > 0 ? round2(rawMrp / (1 + gstRate / 100)) : rawMrp
      const price = cards[i].displayPrice
      return {
        ...cards[i],
        mrp,
        mrpDiscount: mrp && mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0,
        categoryId: row.categories?.id ?? null,
        categorySlug: row.categories?.slug ?? null,
        handlingDays: Number(row.handling_days ?? 2),
        stockStatus: row.stock_status ?? null,
        grade: row.grade ?? null,
        material: row.material ?? null,
        finish: row.finish ?? null,
        complianceStandard: row.compliance_standard ?? null,
      }
    }),
    total: m.total,
    page: m.page,
    pageSize: PAGE_SIZE,
    totalPages: m.totalPages,
    start: m.start,
    end: m.end,
    gstEnabled: m.gstEnabled,
    categories: m.categories.map(c => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      parent_category_id: c.parent_category_id ?? null,
      display_order: c.display_order ?? null,
    })),
    brands: m.brands.map(b => ({ id: b.id, name: b.name })),
    categoryBanners: m.categoryBanners.map(cat => ({
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
      products: (cat.products as any[]).map(p => {
        const img = p.product_images?.[0]
        return {
          id: p.id,
          name: p.name,
          slug: p.slug,
          displayPrice:
            p.has_variants && p.variant_min_price
              ? Number(p.variant_min_price)
              : pickUnitPrice({ inclusive: Number(p.base_price), exGst: p.price_ex_gst ?? undefined }, m.gstEnabled),
          image: img?.image_url ? { image_url: img.image_url, thumbnail_url: img.thumbnail_url ?? null } : null,
        }
      }),
    })),
    facets: m.facets,
    offers: m.filterOffers.map(o => ({ slug: o.slug, title: o.title })),
    promoOffer: m.promoOffer
      ? {
          slug: m.promoOffer.slug,
          title: m.promoOffer.title,
          subtitle: m.promoOffer.subtitle,
          badge_text: m.promoOffer.badge_text,
          badge_color: m.promoOffer.badge_color,
          image_url: m.promoOffer.image_url,
          image_url_mobile: m.promoOffer.image_url_mobile,
          blurhash: m.promoOffer.blurhash,
          blurhash_mobile: m.promoOffer.blurhash_mobile,
          cta_label: m.promoOffer.cta_label,
        }
      : null,
  }
}
