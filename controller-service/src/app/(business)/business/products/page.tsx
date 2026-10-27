export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { headers } from 'next/headers'
import { queryMany, queryOne } from '@/lib/shared/db'
import { VARIANT_MIN_PRICE_INCL_GST_SQL, VARIANT_MIN_PRICE_EX_GST_SQL } from '@/lib/queries'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { positiveInt, productOrderBy, productSortSql } from '@/lib/catalog/product-sort'
import MobileFilterSheet from '@/components/visitor/MobileFilterSheet'
import FilterSidebar from '@/components/visitor/FilterSidebar'
import ProductsSearch from '@/components/visitor/ProductsSearch'
import { buildProductSearchClause, buildProductSearchRank } from '@/lib/catalog/search'
import { buildProductFilterClauses, getFilterFacets } from '@/lib/catalog/product-filters'
import { getOfferBySlug, listActiveOffers, listFilterOffers } from '@/lib/catalog/product-offers'
import ProductCard from '@/components/visitor/ProductCard'
import { pickUnitPrice } from '@/lib/catalog/pricing'
import { round2 } from '@/lib/catalog/gst'
import ProductGrid from '@/components/visitor/ProductGrid'
import RecentlyViewed from '@/components/visitor/RecentlyViewed'
import ListingPromoBanner, { pickPromoOffer } from '@/components/visitor/listing/ListingPromoBanner'
import { bp } from '@/lib/shared/business-path'

const PAGE_SIZE = 60

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

  const whereClause = conditions.join(' AND ')

  const countRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*) AS total FROM products p WHERE ${whereClause}`,
    params
  )
  const total = Number(countRow?.total ?? 0)

  const page = positiveInt(searchParams.page, 1)
  const offset = (page - 1) * PAGE_SIZE

  const { gstEnabled } = await getFeatureFlags()
  const rankParams: unknown[] = []
  let fallback: string | undefined
  if (searchParams.search && !productSortSql(searchParams, gstEnabled)) {
    const rk = buildProductSearchRank(searchParams.search, 'p.name', 'p.search_vector', paramIndex)
    rankParams.push(...rk.params)
    fallback = `${rk.rank}, p.name ASC`
  }
  const orderBy = productOrderBy(searchParams, { gstEnabled, fallback })
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

async function getCategoryBanners() {
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

function renderProductItem(product: any, gstEnabled: boolean) {
  const primaryImage = product.product_images?.find((i: any) => i.is_primary) || product.product_images?.[0]
  const hasVariants = product.has_variants
  const displayPrice =
    hasVariants && product.variant_min_price
      ? Number(product.variant_min_price)
      : pickUnitPrice(
          {
            inclusive: Number(product.base_price),
            exGst: product.price_ex_gst != null ? Number(product.price_ex_gst) : undefined,
          },
          gstEnabled
        )
  const effectiveStock = hasVariants
    ? Number(product.variant_stock_total)
    : product.stock_status !== 'Out of Stock'
      ? 1
      : 0
  const rawMrp = hasVariants
    ? product.variant_min_mrp
      ? Number(product.variant_min_mrp)
      : null
    : product.mrp
      ? Number(product.mrp)
      : null
  const gstRate = Number(product.gst_percentage ?? 0)
  const mrp = !gstEnabled && rawMrp != null && gstRate > 0 ? round2(rawMrp / (1 + gstRate / 100)) : rawMrp
  const mrpDiscount = mrp && mrp > Number(displayPrice) ? Math.round(((mrp - Number(displayPrice)) / mrp) * 100) : 0
  return (
    <ProductCard
      id={product.id}
      name={product.name}
      slug={product.slug}
      hasVariants={hasVariants}
      displayPrice={Number(displayPrice)}
      mrp={mrp}
      mrpDiscount={mrpDiscount}
      effectiveStock={effectiveStock}
      isDigital={!!product.is_digital}
      primaryImage={primaryImage || null}
      brandName={product.brands?.name ?? null}
      categoryName={product.categories?.name ?? null}
      categoryId={product.categories?.id ?? null}
      discountPct={Number(product.discount_pct ?? 0)}
      extraDeliveryDays={Number(product.extra_delivery_days ?? 0)}
      handlingDays={Number(product.handling_days ?? 2)}
      fragile={product.fragile}
      hazardous={product.hazardous}
      flammable={product.flammable}
      portal="business"
    />
  )
}

function buildPageUrl(searchParams: Record<string, string | undefined>, page: number, host: string) {
  const params = new URLSearchParams()
  const keep = [
    'category',
    'brand',
    'offer',
    'search',
    'sort',
    'dir',
    'order',
    'minPrice',
    'maxPrice',
    'inStock',
    'onSale',
    'color',
    'grade',
    'material',
    'finish',
    'compliance',
    'origin',
    'minRating',
    'variantType',
    'variantValue',
    'specKey',
    'specValue',
  ]
  for (const k of keep) if (searchParams[k]) params.set(k, String(searchParams[k]))
  if (page > 1) params.set('page', String(page))
  const qs = params.toString()
  return bp('/business/products', host) + (qs ? `?${qs}` : '')
}

export default async function BusinessProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>
}) {
  const resolvedSearchParams = await searchParams
  const hdrs = await headers()
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host') ?? ''
  const basePath = bp('/business/products', host)

  const { products, total, page, totalPages, gstEnabled } = await getProducts(resolvedSearchParams)
  const [categories, brands] = await Promise.all([getCategories(), getBrands()])
  const categoryBanners = await getCategoryBanners()

  // Facets against the category+brand base only, so scalar-filter counts stay meaningful.
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
  const filterOffers =
    activeOffer && !liveOffers.some(o => o.slug === activeOffer.slug)
      ? [...liveOffers, { slug: activeOffer.slug, title: activeOffer.title }]
      : liveOffers

  const start = (page - 1) * PAGE_SIZE + 1
  const end = Math.min(page * PAGE_SIZE, total)

  const allCats = categories as any[]

  return (
    <div className="bg-surface min-h-screen">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 sm:gap-6 lg:gap-8">
          {/* Sidebar Filters — desktop only */}
          <aside className="hidden lg:block lg:col-span-1 py-6 sticky top-0 self-start max-h-screen overflow-y-auto">
            <div className="mb-4">
              <ProductsSearch defaultValue={resolvedSearchParams.search} portalHeader="business" basePath={basePath} />
            </div>
            <FilterSidebar facets={facets} categories={allCats} offers={filterOffers} basePath={basePath} />
          </aside>

          <div className="lg:col-span-3 py-6">
            <div className="mb-4">
              <h1 className="text-2xl md:text-3xl font-bold text-secondary-500 dark:text-foreground">All Products</h1>
              <p className="text-foreground-secondary text-sm mt-1">Browse our complete range of products</p>
            </div>

            {products.length > 0 ? (
              <>
                {(() => {
                  const items = (products as any[]).map(product => ({
                    key: String(product.id),
                    node: renderProductItem(product, gstEnabled),
                  }))
                  if (page === 1 && promoOffer && items.length > 6) {
                    items.splice(6, 0, {
                      key: 'promo-slot',
                      node: (
                        <div className="col-span-full">
                          <ListingPromoBanner offer={promoOffer} />
                        </div>
                      ),
                    })
                  }
                  return (
                    <ProductGrid
                      products={products as any[]}
                      gstEnabled={gstEnabled}
                      categoryBanners={categoryBanners as any[]}
                      total={total}
                      start={start}
                      end={end}
                      portal="business"
                      filterSlot={
                        <MobileFilterSheet
                          key="mobile-filters"
                          categories={allCats}
                          brands={brands as any[]}
                          facets={facets}
                          offers={filterOffers}
                          basePath={basePath}
                        />
                      }
                      promoSlot={promoOffer ? <ListingPromoBanner offer={promoOffer} /> : undefined}
                      pagedItems={items}
                      page={page}
                      basePath={basePath}
                    />
                  )
                })()}
              </>
            ) : (
              <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-12 text-center">
                <svg
                  className="mx-auto h-24 w-24 text-foreground-muted mb-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1}
                    d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
                  />
                </svg>
                <h3 className="text-xl font-semibold text-foreground mb-2">No Products Found</h3>
                <p className="text-foreground-secondary mb-6">
                  We couldn&apos;t find any products matching your filters. Try adjusting your search criteria.
                </p>
                <Link
                  href={basePath}
                  className="inline-block bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
                >
                  View All Products
                </Link>
              </div>
            )}

            <RecentlyViewed title="Recently viewed" minItems={2} limit={6} basePath={basePath} />
          </div>
        </div>
      </div>
    </div>
  )
}
