import Link from 'next/link'
import { queryMany, queryOne } from '@/lib/db'
import SortDropdown from '@/components/visitor/SortDropdown'
import MobileFilterSheet from '@/components/visitor/MobileFilterSheet'

const PAGE_SIZE = 21

async function getProducts(searchParams: any) {
  const conditions: string[] = ['p.is_active = true']
  const params: any[] = []
  let paramIndex = 1

  if (searchParams.category) {
    conditions.push(`p.category_id IN (
      WITH RECURSIVE cat_tree AS (
        SELECT id FROM categories WHERE id = $${paramIndex}
        UNION ALL
        SELECT c.id FROM categories c JOIN cat_tree ct ON c.parent_category_id = ct.id
      )
      SELECT id FROM cat_tree
    )`)
    params.push(searchParams.category)
    paramIndex++
  }

  if (searchParams.brand) {
    conditions.push(`p.brand_id = $${paramIndex++}`)
    params.push(searchParams.brand)
  }

  if (searchParams.search) {
    conditions.push(`p.name ILIKE $${paramIndex++}`)
    params.push(`%${searchParams.search}%`)
  }

  const sortBy = searchParams.sort || 'created_at'
  const sortOrder = searchParams.order === 'asc' ? 'ASC' : 'DESC'

  const allowedSortColumns: Record<string, string> = {
    created_at: 'p.created_at',
    name: 'p.name',
    base_price: 'p.base_price',
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
    : `p.is_featured DESC, COALESCE(pc.display_order, c.display_order, 9999) ASC, c.display_order ASC, p.created_at DESC`

  const sql = `
    SELECT p.*,
      json_build_object('id', c.id, 'name', c.name, 'slug', c.slug) AS categories,
      json_build_object('id', b.id, 'name', b.name) AS brands,
      COALESCE(
        (SELECT json_agg(pi ORDER BY pi.display_order)
         FROM product_images pi WHERE pi.product_id = p.id),
        '[]'::json
      ) AS product_images,
      COALESCE((SELECT SUM(pv.stock_quantity) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true), 0) AS variant_stock_total,
      (SELECT MIN(COALESCE(pv.sale_price, pv.price)) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true AND (pv.price IS NOT NULL OR pv.sale_price IS NOT NULL)) AS variant_min_price
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN categories pc ON c.parent_category_id = pc.id
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE ${whereClause}
    ORDER BY ${orderBy}
    LIMIT ${PAGE_SIZE} OFFSET ${offset}
  `

  const products = await queryMany(sql, params)
  return { products, total, page, totalPages: Math.ceil(total / PAGE_SIZE) }
}

async function getCategories() {
  return queryMany('SELECT id, name, slug, parent_category_id, display_order FROM categories WHERE is_active = true ORDER BY display_order ASC')
}

async function getBrands() {
  return queryMany('SELECT id, name FROM brands WHERE is_active = true ORDER BY name ASC')
}

function buildPageUrl(searchParams: Record<string, string | undefined>, page: number) {
  const params = new URLSearchParams()
  if (searchParams.category) params.set('category', searchParams.category)
  if (searchParams.brand) params.set('brand', searchParams.brand)
  if (searchParams.search) params.set('search', searchParams.search)
  if (searchParams.sort) params.set('sort', searchParams.sort)
  if (searchParams.order) params.set('order', searchParams.order)
  if (page > 1) params.set('page', String(page))
  const qs = params.toString()
  return `/products${qs ? `?${qs}` : ''}`
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | undefined }
}) {
  const { products, total, page, totalPages } = await getProducts(searchParams)
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
          {/* Sidebar Filters */}
          <aside className="lg:col-span-1 lg:h-full lg:overflow-y-auto py-4 sm:py-6 lg:py-6">
            {/* Mobile bottom-sheet filter */}
            <MobileFilterSheet categories={allCats} brands={brands as any[]} />

            {/* Desktop sidebar filter */}
            <div className="hidden lg:block bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-6">
                <h2 className="font-bold text-lg text-foreground mb-4">Filters</h2>

                {/* Search */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-foreground-secondary mb-2">
                    Search
                  </label>
                  <form action="/products" method="get">
                    <input
                      type="text"
                      name="search"
                      defaultValue={searchParams.search}
                      placeholder="Search products..."
                      className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
                    />
                    <button
                      type="submit"
                      className="mt-2 w-full bg-accent-500 hover:bg-accent-600 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                    >
                      Search
                    </button>
                  </form>
                </div>

                {/* Categories Filter */}
                <div className="mb-6">
                  <h3 className="font-semibold text-foreground mb-3">Categories</h3>
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    <Link
                      href="/products"
                      className={`block px-3 py-2 rounded-lg text-sm transition-colors ${
                        !searchParams.category
                          ? 'bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400 font-medium'
                          : 'text-foreground-secondary hover:bg-surface-secondary'
                      }`}
                    >
                      All Categories
                    </Link>
                    {mainCats.map((cat: any) => {
                      const subs = subCats.filter((s: any) => s.parent_category_id === cat.id)
                      const isActive = searchParams.category === cat.id
                      return (
                        <div key={cat.id}>
                          <Link
                            href={`/products?category=${cat.id}`}
                            className={`block px-3 py-2 rounded-lg text-sm transition-colors font-medium ${
                              isActive
                                ? 'bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400'
                                : 'text-foreground hover:bg-surface-secondary'
                            }`}
                          >
                            {cat.name}
                          </Link>
                          {subs.map((sub: any) => (
                            <Link
                              key={sub.id}
                              href={`/products?category=${sub.id}`}
                              className={`block pl-6 pr-3 py-1.5 rounded-lg text-sm transition-colors ${
                                searchParams.category === sub.id
                                  ? 'bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400 font-medium'
                                  : 'text-foreground-secondary hover:bg-surface-secondary'
                              }`}
                            >
                              {sub.name}
                            </Link>
                          ))}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Brands Filter */}
                <div className="mb-6">
                  <h3 className="font-semibold text-foreground mb-3">Brands</h3>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    <Link
                      href={searchParams.category ? `/products?category=${searchParams.category}` : '/products'}
                      className={`block px-3 py-2 rounded-lg text-sm transition-colors ${
                        !searchParams.brand
                          ? 'bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400 font-medium'
                          : 'text-foreground-secondary hover:bg-surface-secondary'
                      }`}
                    >
                      All Brands
                    </Link>
                    {brands.map((brand: any) => {
                      const params = new URLSearchParams()
                      if (searchParams.category) params.set('category', searchParams.category)
                      params.set('brand', brand.id)

                      return (
                        <Link
                          key={brand.id}
                          href={`/products?${params.toString()}`}
                          className={`block px-3 py-2 rounded-lg text-sm transition-colors ${
                            searchParams.brand === brand.id
                              ? 'bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400 font-medium'
                              : 'text-foreground-secondary hover:bg-surface-secondary'
                          }`}
                        >
                          {brand.name}
                        </Link>
                      )
                    })}
                  </div>
                </div>

                {/* Clear Filters */}
                {(searchParams.category || searchParams.brand || searchParams.search) && (
                  <Link
                    href="/products"
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
            <div className="mb-4">
              <h1 className="text-2xl md:text-3xl font-bold text-secondary-500 dark:text-foreground">All Products</h1>
              <p className="text-foreground-secondary text-sm mt-1">Browse our complete range of hardware and industrial tools</p>
            </div>
            {/* Sort Bar */}
            <div className="flex items-center justify-between mb-6">
              <p className="text-foreground-secondary text-sm">
                {total > 0
                  ? <><span className="font-semibold text-foreground">{start}–{end}</span> of <span className="font-semibold text-foreground">{total}</span> products</>
                  : '0 products found'
                }
              </p>
              <SortDropdown />
            </div>

            {/* Products Grid */}
            {products.length > 0 ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {products.map((product) => {
                    const primaryImage = product.product_images?.find((img: any) => img.is_primary) || product.product_images?.[0]
                    const hasVariants = product.has_variants
                    const displayPrice = hasVariants && product.variant_min_price
                      ? product.variant_min_price
                      : (product.sale_price || product.base_price)
                    const effectiveStock = hasVariants ? Number(product.variant_stock_total) : product.stock_quantity
                    const mrp = product.mrp ? Number(product.mrp) : null
                    const mrpDiscount = mrp && mrp > Number(displayPrice)
                      ? Math.round(((mrp - Number(displayPrice)) / mrp) * 100)
                      : 0

                    return (
                      <Link
                        key={product.id}
                        href={`/products/${product.slug}`}
                        className="group"
                      >
                        <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden hover:shadow-lg transition-shadow h-full flex flex-col">
                          {/* Product Image */}
                          <div className="relative aspect-[5/3] border-2 border-gray-300 dark:border-gray-600 overflow-hidden rounded-lg mx-3 mt-3">
                            {primaryImage ? (
                              <>
                                <img
                                  src={primaryImage.image_url}
                                  alt=""
                                  aria-hidden="true"
                                  className="absolute inset-0 w-full h-full object-cover scale-110 blur-xl opacity-60"
                                />
                                <img
                                  src={primaryImage.image_url}
                                  alt={product.name}
                                  className="relative w-full h-full object-contain"
                                />
                              </>
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <svg className="w-20 h-20 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                              </div>
                            )}
                            {mrpDiscount > 0 && (
                              <div className="absolute top-3 right-3 bg-accent-500 text-white px-2 py-1 rounded-full text-xs font-semibold">
                                {mrpDiscount}% off
                              </div>
                            )}
                          </div>

                          {/* Product Info */}
                          <div className="p-5 flex flex-col flex-grow">
                            <h3 className="font-semibold text-base text-foreground mb-2 group-hover:text-accent-600 transition-colors line-clamp-2 min-h-[3rem]">
                              {product.name}
                            </h3>
                            <div className="text-xs text-foreground-muted mb-3 space-y-1">
                              {product.brands && (
                                <div>Brand: {product.brands.name}</div>
                              )}
                              {product.categories && (
                                <div>Category: {product.categories.name}</div>
                              )}
                            </div>
                            <div className="mt-auto">
                              <div className="flex items-baseline gap-2 mb-1">
                                <span className="text-xl font-bold text-primary-600 dark:text-primary-400">
                                  {hasVariants ? 'From ' : ''}₹{Number(displayPrice).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                </span>
                                {mrp && mrp > Number(displayPrice) && (
                                  <span className="text-sm text-foreground-muted line-through">
                                    ₹{mrp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] text-foreground-muted mb-3">Inclusive of all taxes</p>
                              <div className="flex items-center justify-between">
                                <span className={`text-xs font-medium ${effectiveStock > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                  {effectiveStock > 0 ? 'In Stock' : 'Out of Stock'}
                                </span>
                                <span className="text-accent-500 group-hover:text-accent-600 font-semibold text-sm">
                                  View Details →
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </Link>
                    )
                  })}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-8 mb-4">
                    <Link
                      href={buildPageUrl(searchParams, page - 1)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg border font-medium text-sm transition-colors ${
                        page <= 1
                          ? 'border-border-default text-foreground-muted pointer-events-none opacity-40'
                          : 'border-border-secondary text-foreground-secondary hover:bg-surface-secondary'
                      }`}
                      aria-disabled={page <= 1}
                    >
                      ← Previous
                    </Link>

                    <div className="flex items-center gap-1">
                      {Array.from({ length: totalPages }, (_, i) => i + 1)
                        .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                        .reduce<(number | 'ellipsis')[]>((acc, p, idx, arr) => {
                          if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('ellipsis')
                          acc.push(p)
                          return acc
                        }, [])
                        .map((item, idx) =>
                          item === 'ellipsis' ? (
                            <span key={`ellipsis-${idx}`} className="px-2 text-foreground-muted">…</span>
                          ) : (
                            <Link
                              key={item}
                              href={buildPageUrl(searchParams, item)}
                              className={`w-9 h-9 flex items-center justify-center rounded-lg text-sm font-medium transition-colors ${
                                item === page
                                  ? 'bg-accent-500 text-white'
                                  : 'text-foreground-secondary hover:bg-surface-secondary border border-border-secondary'
                              }`}
                            >
                              {item}
                            </Link>
                          )
                        )}
                    </div>

                    <Link
                      href={buildPageUrl(searchParams, page + 1)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg border font-medium text-sm transition-colors ${
                        page >= totalPages
                          ? 'border-border-default text-foreground-muted pointer-events-none opacity-40'
                          : 'border-border-secondary text-foreground-secondary hover:bg-surface-secondary'
                      }`}
                      aria-disabled={page >= totalPages}
                    >
                      Next →
                    </Link>
                  </div>
                )}
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
