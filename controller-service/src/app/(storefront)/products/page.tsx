import Link from 'next/link'
import MobileFilterSheet from '@/components/visitor/MobileFilterSheet'
import FilterSidebar from '@/components/visitor/FilterSidebar'
import ProductCard from '@/components/visitor/ProductCard'
import { pickUnitPrice } from '@/lib/catalog/pricing'
import { round2 } from '@/lib/catalog/gst'
import { buildListingModel } from '@/lib/catalog/listing-model'
import ProductGrid from '@/components/visitor/ProductGrid'
import CompareStripLazy from '@/components/visitor/CompareStripLazy'
import SearchInsightBanner from '@/components/on-device/SearchInsightBanner'
import RecentlyViewed from '@/components/visitor/RecentlyViewed'
import ListingPromoBanner from '@/components/visitor/listing/ListingPromoBanner'

// Pre-render each product as a server-side ReactNode so pages 2..N appended via
// ServerPagedItems carry the same GST / discount maths without re-shipping product data.
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
    />
  )
}

// Each group is counted without its own filter so sibling brands/categories stay selectable.
function buildPageUrl(searchParams: Record<string, string | undefined>, page: number) {
  const params = new URLSearchParams()
  if (searchParams.category) params.set('category', searchParams.category)
  if (searchParams.brand) params.set('brand', searchParams.brand)
  if (searchParams.offer) params.set('offer', searchParams.offer)
  if (searchParams.search) params.set('search', searchParams.search)
  if (searchParams.sort) params.set('sort', searchParams.sort)
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
  const { products, total, page, start, end, gstEnabled, categories, brands, categoryBanners, facets, filterOffers, promoOffer } =
    await buildListingModel(resolvedSearchParams)

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
              <>
                {(() => {
                  // Server-renders this page's product cards; useServerPages accumulates
                  // page 1..N under one ?page URL replace per advance (no router.push).
                  const items = (products as any[]).map(product => ({
                    key: String(product.id),
                    node: renderProductItem(product, gstEnabled),
                  }))
                  // Promo slot keeps its current page-1 placement (idx 6) by injecting a
                  // col-span-full node; later pages don't re-inject it.
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
                      pagedItems={items}
                      page={page}
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
                  href="/products"
                  className="inline-block bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
                >
                  View All Products
                </Link>
              </div>
            )}

            <RecentlyViewed title="Recently viewed" minItems={2} limit={6} />
          </div>
        </div>
      </div>
    </div>
  )
}
