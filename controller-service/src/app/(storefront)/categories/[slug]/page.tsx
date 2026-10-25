import { notFound } from 'next/navigation'
import Link from 'next/link'
import { queryOne, queryMany } from '@/lib/shared/db'
import { buildListingModel } from '@/lib/catalog/listing-model'
import CategoryIcon from '@/components/visitor/CategoryIcon'
import ProductGrid from '@/components/visitor/ProductGrid'
import MobileFilterSheet from '@/components/visitor/MobileFilterSheet'
import { renderProductItem } from '@/components/visitor/listing/listing-items'

async function getCategoryBySlug(slug: string) {
  return queryOne('SELECT * FROM categories WHERE slug = $1 AND is_active = true LIMIT 1', [slug])
}

async function getSubcategories(parentId: string) {
  return queryMany(
    'SELECT * FROM categories WHERE parent_category_id = $1 AND is_active = true ORDER BY display_order ASC',
    [parentId]
  )
}

// Grid matches the page's full-width layout (no filter sidebar).
const GRID = 'grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-6'

export default async function CategoryDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { slug } = await params
  const resolvedSearchParams = await searchParams
  const category = await getCategoryBySlug(slug)

  if (!category) {
    notFound()
  }

  const subcategories = await getSubcategories(category.id)

  // The /products listing scoped to this category: its filters and sort, with the category
  // filter narrowed only to this category's own subcategories. Default order stays newest first.
  const sp: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(resolvedSearchParams)) sp[k] = Array.isArray(v) ? v[0] : v
  const ownSubs = new Set(subcategories.flatMap(sub => [String(sub.id), sub.slug]))
  const picked = (sp.category ?? '').split(',').filter(c => ownSubs.has(c))
  const { products, total, page, start, end, gstEnabled, facets, filterOffers } = await buildListingModel(
    { ...sp, category: picked.length ? picked.join(',') : String(category.id), sort: sp.sort || 'created_at' },
    { categoryBanners: false }
  )
  const filtered = Object.entries(sp).some(([k, v]) => !!v && !['page', 'sort', 'order'].includes(k))
  const filterSheet = (
    <MobileFilterSheet
      key="mobile-filters"
      basePath={`/categories/${category.slug}`}
      categories={subcategories.map(sub => ({ id: String(sub.id), name: sub.name, parent_category_id: null }))}
      brands={(facets.brands ?? []).map(b => ({ id: b.id, name: b.name }))}
      facets={facets}
      offers={filterOffers}
    />
  )

  return (
    <div className="bg-surface min-h-screen">
      {/* Breadcrumb */}
      <div className="bg-surface-elevated border-b border-border-default">
        <div className="container mx-auto px-4 py-4">
          <nav className="flex items-center gap-2 text-sm mb-4">
            <Link href="/" className="text-foreground-muted hover:text-accent-500">
              Home
            </Link>
            <span className="text-foreground-muted">/</span>
            <Link href="/categories" className="text-foreground-muted hover:text-accent-500">
              Categories
            </Link>
            <span className="text-foreground-muted">/</span>
            <span className="text-foreground font-medium">{category.name}</span>
          </nav>

          <h1 className="text-3xl md:text-4xl font-bold text-secondary-500 dark:text-foreground mb-2">
            {category.name}
          </h1>
          {category.description && <p className="text-foreground-secondary">{category.description}</p>}
        </div>
      </div>

      <div className="container mx-auto px-4 py-4 sm:py-6 lg:py-8">
        {/* Subcategories */}
        {subcategories.length > 0 && (
          <div className="mb-8">
            <h2 className="text-xl font-bold text-foreground mb-4">Subcategories</h2>
            <div className="grid grid-cols-4 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2 sm:gap-3">
              {subcategories.map(subcategory => (
                <Link
                  key={subcategory.id}
                  href={`/categories/${subcategory.slug}`}
                  className="bg-surface-elevated rounded-xl shadow-sm border border-border-default p-2 sm:p-3 hover:shadow-md hover:border-accent-500 transition-all group h-full"
                >
                  <div className="flex flex-col items-center text-center gap-1.5">
                    <div className="w-9 h-9 sm:w-11 sm:h-11 bg-accent-100 rounded-lg flex items-center justify-center group-hover:bg-accent-200 transition-colors shrink-0">
                      <CategoryIcon
                        iconName={subcategory.icon_name}
                        categoryName={subcategory.name}
                        className="w-5 h-5 sm:w-6 sm:h-6 text-accent-600 group-hover:text-accent-700"
                      />
                    </div>
                    <h3 className="text-[11px] sm:text-xs font-semibold text-foreground group-hover:text-accent-600 dark:group-hover:text-accent-400 transition-colors leading-tight line-clamp-2 flex items-center justify-center min-h-[2rem]">
                      {subcategory.name}
                    </h3>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Products */}
        <div>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-foreground">Products ({total})</h2>
          </div>

          {products.length > 0 ? (
            <ProductGrid
              products={products}
              gstEnabled={gstEnabled}
              total={total}
              start={start}
              end={end}
              filterSlot={filterSheet}
              pagedItems={products.map(product => ({
                key: String(product.id),
                node: renderProductItem(product, gstEnabled),
              }))}
              page={page}
              basePath={`/categories/${category.slug}`}
              gridClassName={GRID}
            />
          ) : (
            <>
              {filtered && <div className="flex gap-2 mb-4 lg:hidden">{filterSheet}</div>}
              <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-6 sm:p-12 text-center">
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
                <h3 className="text-xl font-semibold text-foreground mb-2">
                  {filtered ? 'No Products Found' : 'No Products Yet'}
                </h3>
                <p className="text-foreground-secondary mb-6">
                  {filtered
                    ? 'Nothing in this category matches these filters. Try adjusting them.'
                    : "We're working on adding products to this category. Check back soon!"}
                </p>
                <Link
                  href={filtered ? `/categories/${category.slug}` : '/products'}
                  className="inline-block bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
                >
                  {filtered ? 'Clear filters' : 'Browse All Products'}
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
