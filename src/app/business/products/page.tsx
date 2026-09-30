export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { headers } from 'next/headers'
import { queryMany, queryOne } from '@/lib/db'
import { mrpDiscountPct, pickUnitPrice } from '@/lib/pricing'
import { VARIANT_MIN_PRICE_INCL_GST_SQL, VARIANT_MIN_PRICE_EX_GST_SQL } from '@/lib/queries'
import { getFeatureFlags } from '@/lib/site-controls'
import SortDropdown from '@/components/visitor/SortDropdown'
import MobileFilterSheet from '@/components/visitor/MobileFilterSheet'
import ProductsSearch from '@/components/visitor/ProductsSearch'
import { buildSearchClause, buildSearchRank } from '@/lib/search'
import Pagination from '@/components/ui/Pagination'
import ProductCard from '@/components/business/ProductCard'
import { bp } from '@/lib/business-path'

const PAGE_SIZE = 21

async function getCategoryIds(catVal: string): Promise<string[]> {
  const rows = await queryMany<{ id: string }>(
    `WITH RECURSIVE cat_tree AS (
       SELECT id FROM categories WHERE id::text = $1 OR slug = $1
       UNION ALL
       SELECT c.id FROM categories c JOIN cat_tree ct ON c.parent_category_id = ct.id
     )
     SELECT id FROM cat_tree`,
    [catVal]
  )
  return rows.map(r => r.id)
}

async function getProducts(searchParams: any) {
  const conditions: string[] = ['p.is_active = true']
  const params: any[] = []
  let paramIndex = 1

  if (searchParams.category) {
    const catVals = String(searchParams.category).split(',').filter(Boolean)
    if (catVals.length === 1) {
      const catIds = await getCategoryIds(catVals[0])
      if (catIds.length === 0) {
        conditions.push('false')
      } else {
        const placeholders = catIds.map((_, i) => `$${paramIndex + i}`).join(', ')
        conditions.push(`p.category_id IN (${placeholders})`)
        params.push(...catIds)
        paramIndex += catIds.length
      }
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

  if (searchParams.search) {
    const sc = buildSearchClause(searchParams.search, ['p.name', 'p.sku'], paramIndex)
    conditions.push(sc.clause)
    params.push(...sc.params)
    paramIndex = sc.nextIdx
  }

  const sortBy = searchParams.sort || 'created_at'
  const sortOrder = searchParams.order === 'asc' ? 'ASC' : 'DESC'

  const allowedSortColumns: Record<string, string> = {
    created_at: 'p.created_at',
    name: 'p.name',
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

  const orderBy = hasExplicitSort
    ? `${sortColumn} ${sortOrder}`
    : searchParams.search
      ? `${buildSearchRank(searchParams.search, 'p.name')}, p.name ASC`
      : `p.is_featured DESC, COALESCE(pc.display_order, c.display_order, 9999) ASC, c.display_order ASC, p.created_at DESC`

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

  const products = await queryMany(sql, params)
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

function buildPageUrl(searchParams: Record<string, string | undefined>, page: number, host: string) {
  const params = new URLSearchParams()
  if (searchParams.category) params.set('category', searchParams.category)
  if (searchParams.brand) params.set('brand', searchParams.brand)
  if (searchParams.search) params.set('search', searchParams.search)
  if (searchParams.sort) params.set('sort', searchParams.sort)
  if (searchParams.order) params.set('order', searchParams.order)
  if (page > 1) params.set('page', String(page))
  const qs = params.toString()
  return bp('/business/products', host) + (qs ? `?${qs}` : '')
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>
}) {
  const resolvedSearchParams = await searchParams
  const hdrs = await headers()
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host') ?? ''
  const { products, total, page, totalPages, gstEnabled } = await getProducts(resolvedSearchParams)
  const categories = await getCategories()
  const brands = await getBrands()

  const start = (page - 1) * PAGE_SIZE + 1
  const end = Math.min(page * PAGE_SIZE, total)

  const [allCats, setAllCats] = [categories as any[], null]
  const mainCats = allCats.filter((c: any) => !c.parent_category_id)
  const subCats = allCats.filter((c: any) => c.parent_category_id)

  return (
    <div className="bg-surface min-h-screen lg:h-[calc(100vh-5rem)] lg:overflow-hidden">
      <div className="container mx-auto px-4 h-full">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 sm:gap-6 lg:gap-8 lg:h-full">
          {/* Sidebar Filters — desktop only */}
          <aside className="hidden lg:block lg:col-span-1 lg:h-full lg:overflow-y-auto py-4 sm:py-6 lg:py-6">
            {/* Desktop sidebar filter */}
            <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-6">
              <h2 className="font-bold text-lg text-foreground mb-4">Filters</h2>

              {/* Search */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-foreground-secondary mb-2">Search</label>
                <ProductsSearch
                  defaultValue={resolvedSearchParams.search}
                  portalHeader="business"
                  basePath={bp('/business/products', host)}
                />
              </div>

              {/* Categories Filter */}
              <div className="mb-6">
                <h3 className="font-semibold text-foreground mb-3">Categories</h3>
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {(() => {
                    const activeCats = resolvedSearchParams.category ? resolvedSearchParams.category.split(',') : []
                    const activeBrands = resolvedSearchParams.brand ? resolvedSearchParams.brand.split(',') : []

                    function catIsActive(cat: any) {
                      return activeCats.includes(cat.id) || activeCats.includes(cat.slug)
                    }

                    function toggleCatUrl(cat: any) {
                      const active = catIsActive(cat)
                      const next = active
                        ? activeCats.filter(v => v !== cat.id && v !== cat.slug)
                        : [...activeCats.filter(v => v !== cat.id && v !== cat.slug), cat.id]
                      const p = new URLSearchParams()
                      if (next.length) p.set('category', next.join(','))
                      if (activeBrands.length) p.set('brand', activeBrands.join(','))
                      if (resolvedSearchParams.sort) p.set('sort', resolvedSearchParams.sort)
                      if (resolvedSearchParams.order) p.set('order', resolvedSearchParams.order)
                      if (resolvedSearchParams.search) p.set('search', resolvedSearchParams.search)
                      return bp('/business/products', host) + (p.toString() ? `?${p.toString()}` : '')
                    }

                    return (
                      <>
                        <Link
                          href={bp('/business/products', host)}
                          className={`block px-3 py-2 rounded-lg text-sm transition-colors ${
                            activeCats.length === 0
                              ? 'bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400 font-medium'
                              : 'text-foreground-secondary hover:bg-surface-secondary'
                          }`}
                        >
                          All Categories
                        </Link>
                        {mainCats.map((cat: any) => {
                          const subs = subCats.filter((s: any) => s.parent_category_id === cat.id)
                          const isActive = catIsActive(cat)
                          return (
                            <div key={cat.id}>
                              <Link
                                href={toggleCatUrl(cat)}
                                className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors font-medium ${
                                  isActive
                                    ? 'bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400'
                                    : 'text-foreground hover:bg-surface-secondary'
                                }`}
                              >
                                {cat.name}
                                {isActive && (
                                  <svg
                                    className="w-3.5 h-3.5 text-accent-500 shrink-0"
                                    fill="currentColor"
                                    viewBox="0 0 20 20"
                                  >
                                    <path
                                      fillRule="evenodd"
                                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                                      clipRule="evenodd"
                                    />
                                  </svg>
                                )}
                              </Link>
                              {subs.map((sub: any) => {
                                const isSubActive = catIsActive(sub)
                                return (
                                  <Link
                                    key={sub.id}
                                    href={toggleCatUrl(sub)}
                                    className={`flex items-center justify-between pl-6 pr-3 py-1.5 rounded-lg text-sm transition-colors ${
                                      isSubActive
                                        ? 'bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400 font-medium'
                                        : 'text-foreground-secondary hover:bg-surface-secondary'
                                    }`}
                                  >
                                    {sub.name}
                                    {isSubActive && (
                                      <svg
                                        className="w-3.5 h-3.5 text-accent-500 shrink-0"
                                        fill="currentColor"
                                        viewBox="0 0 20 20"
                                      >
                                        <path
                                          fillRule="evenodd"
                                          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                                          clipRule="evenodd"
                                        />
                                      </svg>
                                    )}
                                  </Link>
                                )
                              })}
                            </div>
                          )
                        })}
                      </>
                    )
                  })()}
                </div>
              </div>

              {/* Brands Filter */}
              <div className="mb-6">
                <h3 className="font-semibold text-foreground mb-3">Brands</h3>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {(() => {
                    const activeCats = resolvedSearchParams.category ? resolvedSearchParams.category.split(',') : []
                    const activeBrands = resolvedSearchParams.brand ? resolvedSearchParams.brand.split(',') : []

                    function brandIsActive(brand: any) {
                      return activeBrands.includes(brand.id) || activeBrands.includes(brand.slug)
                    }

                    function toggleBrandUrl(brand: any) {
                      const active = brandIsActive(brand)
                      const next = active
                        ? activeBrands.filter(v => v !== brand.id && v !== brand.slug)
                        : [...activeBrands.filter(v => v !== brand.id && v !== brand.slug), brand.id]
                      const p = new URLSearchParams()
                      if (activeCats.length) p.set('category', activeCats.join(','))
                      if (next.length) p.set('brand', next.join(','))
                      if (resolvedSearchParams.sort) p.set('sort', resolvedSearchParams.sort)
                      if (resolvedSearchParams.order) p.set('order', resolvedSearchParams.order)
                      if (resolvedSearchParams.search) p.set('search', resolvedSearchParams.search)
                      return bp('/business/products', host) + (p.toString() ? `?${p.toString()}` : '')
                    }

                    const clearBrandsUrl = (() => {
                      const p = new URLSearchParams()
                      if (activeCats.length) p.set('category', activeCats.join(','))
                      if (resolvedSearchParams.sort) p.set('sort', resolvedSearchParams.sort)
                      if (resolvedSearchParams.order) p.set('order', resolvedSearchParams.order)
                      if (resolvedSearchParams.search) p.set('search', resolvedSearchParams.search)
                      return bp('/business/products', host) + (p.toString() ? `?${p.toString()}` : '')
                    })()

                    return (
                      <>
                        <Link
                          href={clearBrandsUrl}
                          className={`block px-3 py-2 rounded-lg text-sm transition-colors ${
                            activeBrands.length === 0
                              ? 'bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400 font-medium'
                              : 'text-foreground-secondary hover:bg-surface-secondary'
                          }`}
                        >
                          All Brands
                        </Link>
                        {brands.map((brand: any) => {
                          const isActive = brandIsActive(brand)
                          return (
                            <Link
                              key={brand.id}
                              href={toggleBrandUrl(brand)}
                              className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                                isActive
                                  ? 'bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400 font-medium'
                                  : 'text-foreground-secondary hover:bg-surface-secondary'
                              }`}
                            >
                              {brand.name}
                              {isActive && (
                                <svg
                                  className="w-3.5 h-3.5 text-accent-500 shrink-0"
                                  fill="currentColor"
                                  viewBox="0 0 20 20"
                                >
                                  <path
                                    fillRule="evenodd"
                                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                                    clipRule="evenodd"
                                  />
                                </svg>
                              )}
                            </Link>
                          )
                        })}
                      </>
                    )
                  })()}
                </div>
              </div>

              {/* Clear Filters */}
              {(resolvedSearchParams.category || resolvedSearchParams.brand || resolvedSearchParams.search) && (
                <Link
                  href={bp('/business/products', host)}
                  className="block text-center w-full px-4 py-2 border border-border-secondary rounded-lg text-foreground-secondary hover:bg-surface-secondary font-medium transition-colors"
                >
                  Clear All Filters
                </Link>
              )}
            </div>
          </aside>

          {/* Products Grid */}
          <div className="lg:col-span-3 lg:h-full lg:overflow-y-auto py-4 sm:py-6 lg:py-6">
            {/* Page heading */}
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl md:text-3xl font-bold text-secondary-500 dark:text-foreground">All Products</h1>
                <p className="text-foreground-secondary text-sm mt-1">Browse our complete range of products</p>
              </div>
              <div className="lg:hidden shrink-0">
                <MobileFilterSheet
                  categories={allCats}
                  brands={brands as any[]}
                  basePath={bp('/business/products', host)}
                />
              </div>
            </div>
            {/* Sort Bar */}
            <div className="flex items-center justify-between mb-6">
              <p className="text-foreground-secondary text-sm">
                {total > 0 ? (
                  <>
                    <span className="font-semibold text-foreground">
                      {start}–{end}
                    </span>{' '}
                    of <span className="font-semibold text-foreground">{total}</span> products
                  </>
                ) : (
                  '0 products found'
                )}
              </p>
              <SortDropdown basePath={bp('/business/products', host)} />
            </div>

            {/* Products Grid */}
            {products.length > 0 ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 stagger-grid">
                  {products.map(product => {
                    const primaryImage =
                      product.product_images?.find((img: any) => img.is_primary) || product.product_images?.[0]
                    const hasVariants = product.has_variants
                    const displayPrice =
                      hasVariants && product.variant_min_price
                        ? product.variant_min_price
                        : pickUnitPrice({ inclusive: product.base_price, exGst: product.price_ex_gst }, gstEnabled)
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
                    // When GST is off, displayPrice is ex-GST, so put the (inclusive)
                    // MRP on the same ex-GST basis before computing discount / striking through.
                    const gstRate = Number(product.gst_percentage ?? 0)
                    const mrpBasis =
                      !gstEnabled && rawMrp != null && gstRate > 0 ? rawMrp / (1 + gstRate / 100) : rawMrp
                    const mrpDiscount = mrpDiscountPct(mrpBasis, Number(displayPrice))

                    return (
                      <ProductCard
                        key={product.id}
                        id={product.id}
                        name={product.name}
                        slug={product.slug}
                        hasVariants={hasVariants}
                        displayPrice={Number(displayPrice)}
                        mrp={mrpBasis}
                        mrpDiscount={mrpDiscount}
                        effectiveStock={effectiveStock}
                        primaryImage={primaryImage}
                        brandName={product.brands?.name ?? null}
                        categoryName={product.categories?.name ?? null}
                        categoryId={product.categories?.id ?? null}
                        extraDeliveryDays={Number(product.extra_delivery_days ?? 0)}
                        handlingDays={Number(product.handling_days ?? 2)}
                      />
                    )
                  })}
                </div>

                {/* Pagination */}
                <Pagination
                  page={page}
                  totalPages={totalPages}
                  buildHref={p => buildPageUrl(resolvedSearchParams, p, host)}
                />
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
                  href={bp('/business/products', host)}
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
