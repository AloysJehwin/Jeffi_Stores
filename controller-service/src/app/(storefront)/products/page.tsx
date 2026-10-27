import Link from 'next/link'
import MobileFilterSheet from '@/components/visitor/MobileFilterSheet'
import FilterSidebar from '@/components/visitor/FilterSidebar'
import { renderProductItem } from '@/components/visitor/listing/listing-items'
import { LISTING_PAGE_SIZE, buildListingModel } from '@/lib/catalog/listing-model'
import { getWebSurface } from '@/lib/catalog/web-surface'
import { withListingSections, type PagedItem } from '@/components/visitor/listing/listing-sections'
import ProductGrid from '@/components/visitor/ProductGrid'
import CompareStripLazy from '@/components/visitor/CompareStripLazy'
import SearchInsightBanner from '@/components/on-device/SearchInsightBanner'
import RecentlyViewed from '@/components/visitor/RecentlyViewed'
import ListingPromoBanner from '@/components/visitor/listing/ListingPromoBanner'

// Each group is counted without its own filter so sibling brands/categories stay selectable.
function buildPageUrl(searchParams: Record<string, string | undefined>, page: number) {
  const params = new URLSearchParams()
  if (searchParams.category) params.set('category', searchParams.category)
  if (searchParams.brand) params.set('brand', searchParams.brand)
  if (searchParams.offer) params.set('offer', searchParams.offer)
  if (searchParams.search) params.set('search', searchParams.search)
  if (searchParams.sort) params.set('sort', searchParams.sort)
  if (searchParams.dir) params.set('dir', searchParams.dir)
  if (searchParams.order) params.set('order', searchParams.order)
  if (searchParams.minPrice) params.set('minPrice', searchParams.minPrice)
  if (searchParams.maxPrice) params.set('maxPrice', searchParams.maxPrice)
  if (searchParams.inStock) params.set('inStock', searchParams.inStock)
  if (searchParams.onSale) params.set('onSale', searchParams.onSale)
  if (searchParams.color) params.set('color', searchParams.color)
  if (searchParams.grade) params.set('grade', searchParams.grade)
  if (searchParams.material) params.set('material', searchParams.material)
  if (searchParams.finish) params.set('finish', searchParams.finish)
  if (searchParams.compliance) params.set('compliance', searchParams.compliance)
  if (searchParams.origin) params.set('origin', searchParams.origin)
  if (searchParams.minRating) params.set('minRating', searchParams.minRating)
  if (searchParams.variantType) params.set('variantType', searchParams.variantType)
  if (searchParams.variantValue) params.set('variantValue', searchParams.variantValue)
  if (searchParams.specKey) params.set('specKey', searchParams.specKey)
  if (searchParams.specValue) params.set('specValue', searchParams.specValue)
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
  const {
    products,
    total,
    page,
    start,
    end,
    gstEnabled,
    categories,
    brands,
    categoryBanners,
    facets,
    filterOffers,
    promoOffer,
  } = await buildListingModel(resolvedSearchParams)

  // Server-renders this page's product cards; useServerPages accumulates page 1..N under one
  // ?page URL replace per advance (no router.push).
  const items: PagedItem[] = (products as any[]).map(product => ({
    key: String(product.id),
    node: renderProductItem(product, gstEnabled),
  }))
  // Promo slot keeps its page-1 placement (idx 6) as a col-span-full node; later pages don't re-inject it.
  if (page === 1 && promoOffer && items.length > 6) {
    items.splice(6, 0, {
      key: 'promo-slot',
      extra: true,
      node: (
        <div className="col-span-full">
          <ListingPromoBanner offer={promoOffer} />
        </div>
      ),
    })
  }
  const pagedItems = await withListingSections(items, {
    page: 'products',
    surface: await getWebSurface(resolvedSearchParams.layout),
    pageNum: page,
    pageSize: LISTING_PAGE_SIZE,
    total,
  })

  const allCats = categories as any[]
  const mainCats = allCats.filter((c: any) => !c.parent_category_id)
  const subCats = allCats.filter((c: any) => c.parent_category_id)

  return (
    <div className="bg-surface min-h-screen">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 sm:gap-6 lg:gap-8">
          {/* Sidebar Filters — desktop only */}
          <aside className="hidden lg:block lg:col-span-1 py-6 sticky top-0 self-start max-h-screen overflow-y-auto">
            <FilterSidebar facets={facets} categories={allCats} offers={filterOffers} />
          </aside>

          {/* Products area */}
          <div className="lg:col-span-3 py-6">
            {/* Page heading */}
            <div className="mb-4">
              <h1 className="text-2xl md:text-3xl font-bold text-secondary-500 dark:text-foreground">All Products</h1>
            </div>
            {/* Compare strip */}
            <CompareStripLazy />

            {/* Profile-based insight banner */}
            <SearchInsightBanner
              activeBrands={(brands as any[])
                .filter(
                  (b: any) =>
                    resolvedSearchParams.brand?.split(',').includes(String(b.id)) ||
                    resolvedSearchParams.brand?.split(',').includes(b.slug)
                )
                .map((b: any) => b.name)}
              activeCategories={(categories as any[])
                .filter(
                  (c: any) =>
                    resolvedSearchParams.category?.split(',').includes(String(c.id)) ||
                    resolvedSearchParams.category?.split(',').includes(c.slug)
                )
                .map((c: any) => c.name)}
              resultCount={total}
            />

            {/* Products Grid */}
            {products.length > 0 ? (
              <ProductGrid
                products={products as any[]}
                gstEnabled={gstEnabled}
                categoryBanners={categoryBanners as any[]}
                total={total}
                start={start}
                end={end}
                filterSlot={
                  <MobileFilterSheet
                    key="mobile-filters"
                    categories={allCats}
                    brands={brands as any[]}
                    facets={facets}
                    offers={filterOffers}
                  />
                }
                promoSlot={promoOffer ? <ListingPromoBanner offer={promoOffer} /> : undefined}
                pagedItems={pagedItems}
                page={page}
              />
            ) : (
              <>
                {/* Phones keep the filter sheet so a dead-end filter can be undone. */}
                <div className="flex gap-2 mb-4 lg:hidden">
                  <MobileFilterSheet
                    categories={allCats}
                    brands={brands as any[]}
                    facets={facets}
                    offers={filterOffers}
                  />
                </div>
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
              </>
            )}

            <RecentlyViewed title="Recently viewed" minItems={2} limit={6} />
          </div>
        </div>
      </div>
    </div>
  )
}
