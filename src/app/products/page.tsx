import Link from 'next/link'
import { queryMany, queryOne } from '@/lib/db'
import { VARIANT_MIN_PRICE_INCL_GST_SQL, VARIANT_MIN_PRICE_EX_GST_SQL } from '@/lib/queries'
import { getFeatureFlags } from '@/lib/site-controls'
import MobileFilterSheet from '@/components/visitor/MobileFilterSheet'
import FilterSidebar from '@/components/visitor/FilterSidebar'
import ProductsSearch from '@/components/visitor/ProductsSearch'
import { buildProductSearchClause, buildProductSearchRank } from '@/lib/search'
import { buildProductFilterClauses, getFilterFacets } from '@/lib/product-filters'
import Pagination from '@/components/ui/Pagination'
import ProductGrid from '@/components/visitor/ProductGrid'
import CompareStripLazy from '@/components/visitor/CompareStripLazy'
import SearchInsightBanner from '@/components/on-device/SearchInsightBanner'

const PAGE_SIZE = 60

async function getProducts(searchParams: any) {
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

  const sortBy = searchParams.sort || 'created_at'
  const sortOrder = searchParams.order === 'asc' ? 'ASC' : 'DESC'

  const allowedSortColumns: Record<string, string> = {
    created_at: 'p.created_at',
    name: 'p.name',
    category: 'c.name, p.name',  // group-by-category sort
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
  const withProducts = await Promise.all(cats.map(async cat => {
    const products = await queryMany<any>(`
      SELECT p.id, p.name, p.slug, p.has_variants, p.base_price, p.price_ex_gst,
        MIN(pv.price) FILTER (WHERE pv.is_active) AS variant_min_price,
        (SELECT json_agg(json_build_object('image_url', pi2.image_url, 'thumbnail_url', pi2.thumbnail_url))
           FROM product_images pi2 WHERE pi2.product_id = p.id LIMIT 1) AS product_images
      FROM products p
      JOIN categories sub ON p.category_id = sub.id AND sub.parent_category_id = $1
      LEFT JOIN product_variants pv ON pv.product_id = p.id
      WHERE p.is_active = true
      GROUP BY p.id ORDER BY p.is_featured DESC, p.created_at DESC LIMIT 12
    `, [cat.id])
    return { ...cat, products }
  }))
  return withProducts.filter(c => c.products.length >= 2)
}

function buildPageUrl(searchParams: Record<string, string | undefined>, page: number) {
  const params = new URLSearchParams()
  if (searchParams.category) params.set('category', searchParams.category)
  if (searchParams.brand)    params.set('brand',    searchParams.brand)
  if (searchParams.search)   params.set('search',   searchParams.search)
  if (searchParams.sort)     params.set('sort',     searchParams.sort)
  if (searchParams.order)    params.set('order',    searchParams.order)
  if (searchParams.minPrice)   params.set('minPrice',   searchParams.minPrice)
  if (searchParams.maxPrice)   params.set('maxPrice',   searchParams.maxPrice)
  if (searchParams.inStock)    params.set('inStock',    searchParams.inStock)
  if (searchParams.onSale)     params.set('onSale',     searchParams.onSale)
  if (searchParams.color)      params.set('color',      searchParams.color)
  if (searchParams.grade)      params.set('grade',      searchParams.grade)
  if (searchParams.material)   params.set('material',   searchParams.material)
  if (searchParams.finish)     params.set('finish',     searchParams.finish)
  if (searchParams.compliance) params.set('compliance', searchParams.compliance)
  if (searchParams.origin)     params.set('origin',     searchParams.origin)
  if (searchParams.minRating)  params.set('minRating',  searchParams.minRating)
  if (searchParams.variantType) params.set('variantType', searchParams.variantType)
  if (searchParams.variantValue) params.set('variantValue', searchParams.variantValue)
  if (searchParams.specKey)    params.set('specKey',    searchParams.specKey)
  if (searchParams.specValue)  params.set('specValue',  searchParams.specValue)
  if (page > 1) params.set('page', String(page))
  const qs = params.toString()
  return `/products${qs ? `?${qs}` : ''}`
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>
}) {
  const resolvedSearchParams = await searchParams
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
      facetBaseParams.push(catVals[0]); facetIdx++
    } else {
      const parts = catVals.map(() => { const p = facetIdx++; return `(id::text = $${p} OR slug = $${p})` })
      facetBaseConditions.push(`p.category_id IN (SELECT id FROM categories WHERE ${parts.join(' OR ')})`)
      facetBaseParams.push(...catVals)
    }
  }
  if (resolvedSearchParams.brand) {
    const brandVals = String(resolvedSearchParams.brand).split(',').filter(Boolean)
    const parts = brandVals.map(() => { const p = facetIdx++; return `(id::text = $${p} OR slug = $${p})` })
    facetBaseConditions.push(`p.brand_id IN (SELECT id FROM brands WHERE ${parts.join(' OR ')})`)
    facetBaseParams.push(...brandVals)
  }
  const facets = await getFilterFacets(facetBaseConditions, facetBaseParams)

  const start = (page - 1) * PAGE_SIZE + 1
  const end = Math.min(page * PAGE_SIZE, total)

  const allCats = categories as any[]
  const mainCats = allCats.filter((c: any) => !c.parent_category_id)
  const subCats = allCats.filter((c: any) => c.parent_category_id)

  return (
    <div className="bg-surface min-h-screen">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 sm:gap-6 lg:gap-8">
          {/* Sidebar Filters — desktop only */}
          <aside className="hidden lg:block lg:col-span-1 py-6 sticky top-0 self-start max-h-screen overflow-y-auto">
            <FilterSidebar facets={facets} categories={allCats} />
          </aside>

          {/* Products area */}
          <div className="lg:col-span-3 py-6">
            {/* Page heading */}
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl md:text-3xl font-bold text-secondary-500 dark:text-foreground">All Products</h1>
                <p className="text-foreground-secondary text-sm mt-1">Browse our complete range of hardware and industrial tools</p>
              </div>
              <div className="lg:hidden shrink-0">
                <MobileFilterSheet categories={allCats} brands={brands as any[]} facets={facets} />
              </div>
            </div>
            {/* Compare strip */}
            <CompareStripLazy />

            {/* Profile-based insight banner */}
            <SearchInsightBanner
              activeBrands={(brands as any[])
                .filter((b: any) => resolvedSearchParams.brand?.split(',').includes(String(b.id)) || resolvedSearchParams.brand?.split(',').includes(b.slug))
                .map((b: any) => b.name)}
              activeCategories={(categories as any[])
                .filter((c: any) => resolvedSearchParams.category?.split(',').includes(String(c.id)) || resolvedSearchParams.category?.split(',').includes(c.slug))
                .map((c: any) => c.name)}
              resultCount={total}
            />

            {/* Products Grid */}
            {products.length > 0 ? (
              <>
                <ProductGrid products={products as any[]} gstEnabled={gstEnabled} categoryBanners={categoryBanners as any[]} total={total} start={start} end={end} />
                <Pagination
                  page={page}
                  totalPages={totalPages}
                  buildHref={(p) => buildPageUrl(resolvedSearchParams, p)}
                />
              </>
            ) : (
              <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-12 text-center">
                <svg className="mx-auto h-24 w-24 text-foreground-muted mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                </svg>
                <h3 className="text-xl font-semibold text-foreground mb-2">No Products Found</h3>
                <p className="text-foreground-secondary mb-6">
                  We couldn&apos;t find any products matching your filters. Try adjusting your search criteria.
                </p>
                <Link
                  href="/products"
                  className="inline-block bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
                >
                  View All Products
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
