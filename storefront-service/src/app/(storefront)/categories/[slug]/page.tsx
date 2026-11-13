import { notFound } from 'next/navigation'
import Link from 'next/link'
import { cache } from 'react'
import type { Metadata } from 'next'
import { queryOne, queryMany } from '@/lib/shared/db'
import { LISTING_PAGE_SIZE, buildListingModel } from '@/lib/catalog/listing-model'
import { getWebSurface } from '@/lib/catalog/web-surface'
import { breadcrumbJsonLd, ldJson, listingMetadata } from '@/lib/catalog/listing-seo'
import CategoryIcon from '@/components/visitor/CategoryIcon'
import ProductGrid from '@/components/visitor/ProductGrid'
import MobileFilterSheet from '@/components/visitor/MobileFilterSheet'
import { renderProductItem } from '@/components/visitor/listing/listing-items'
import { withListingSections } from '@/components/visitor/listing/listing-sections'
import { SeoContent } from '@/components/visitor/brand/BrandProfile'
import { CategoryFaqs, listCategoryFaqs } from '@/components/visitor/category/CategoryFaqs'

const getCategoryBySlug = cache(async (slug: string) =>
  queryOne(
    `SELECT c.*, pc.name AS parent_name, pc.slug AS parent_slug
       FROM categories c
       LEFT JOIN categories pc ON pc.id = c.parent_category_id AND pc.is_active = true
      WHERE c.slug = $1 AND c.is_active = true
      LIMIT 1`,
    [slug]
  )
)

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const category = await getCategoryBySlug(slug)
  if (!category) return { title: 'Category Not Found' }
  return listingMetadata({
    title: category.meta_title || category.name,
    description: category.meta_description || category.description,
    fallbackDescription: `Shop ${category.name}${category.parent_name ? ` in ${category.parent_name}` : ''}.`,
    path: `/categories/${category.slug}`,
    image: category.hero_image_desktop || category.image_url,
    noindex: category.seo_noindex === true,
  })
}

async function getSubcategories(parentId: string) {
  return queryMany(
    'SELECT * FROM categories WHERE parent_category_id = $1 AND is_active = true ORDER BY display_order ASC',
    [parentId]
  )
}

// Grid matches the page's full-width layout (no filter sidebar).
const GRID = 'grid grid-flow-row-dense grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-6'

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

  const [subcategories, faqs] = await Promise.all([getSubcategories(category.id), listCategoryFaqs(category.id)])
  const crumbs = [
    { name: 'Home', path: '/' },
    { name: 'Categories', path: '/categories' },
    ...(category.parent_slug ? [{ name: category.parent_name, path: `/categories/${category.parent_slug}` }] : []),
    { name: category.name },
  ]
  const crumbLd = await breadcrumbJsonLd(crumbs)
  const heroDesktop: string | null = category.hero_image_desktop || null
  const heroMobile: string | null = category.hero_image_mobile || heroDesktop

  // The /products listing scoped to this category: its filters and sort, with the category
  // filter narrowed only to this category's own subcategories. Default order is the category's
  // default_sort (a ?sort= key), else Featured like /products.
  const sp: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(resolvedSearchParams)) sp[k] = Array.isArray(v) ? v[0] : v
  if (!sp.sort && category.default_sort) sp.sort = String(category.default_sort)
  const ownSubs = new Set(subcategories.flatMap(sub => [String(sub.id), sub.slug]))
  const picked = (sp.category ?? '').split(',').filter(c => ownSubs.has(c))
  const { products, total, page, start, end, gstEnabled, facets, filterOffers } = await buildListingModel(
    { ...sp, category: picked.length ? picked.join(',') : String(category.id) },
    { categoryBanners: false }
  )
  const filtered = Object.entries(sp).some(([k, v]) => !!v && !['page', 'sort', 'dir', 'order', 'layout'].includes(k))
  const pagedItems = await withListingSections(
    products.map(product => ({ key: String(product.id), node: renderProductItem(product, gstEnabled) })),
    { page: 'category', surface: await getWebSurface(sp.layout), pageNum: page, pageSize: LISTING_PAGE_SIZE, total }
  )
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
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(crumbLd) }} />
      {/* Breadcrumb */}
      <div className="bg-surface-elevated border-b border-border-default">
        <div className="container mx-auto px-4 py-4">
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm mb-4">
            {crumbs.map((crumb, i) => (
              <span key={crumb.path ?? crumb.name} className="flex items-center gap-2">
                {i > 0 && <span className="text-foreground-muted">/</span>}
                {crumb.path ? (
                  <Link href={crumb.path} className="text-foreground-muted hover:text-accent-500">
                    {crumb.name}
                  </Link>
                ) : (
                  <span className="text-foreground font-medium">{crumb.name}</span>
                )}
              </span>
            ))}
          </nav>

          <h1 className="text-3xl md:text-4xl font-bold text-secondary-500 dark:text-foreground mb-2">
            {category.name}
          </h1>
          {category.tagline && <p className="text-lg text-foreground font-medium mb-1">{category.tagline}</p>}
          {category.description && <p className="text-foreground-secondary">{category.description}</p>}
        </div>
      </div>

      {heroDesktop || heroMobile ? (
        <div className="container mx-auto px-4 pt-4 sm:pt-6">
          {(() => {
            const hero = (
              <picture>
                {heroDesktop && <source media="(min-width: 768px)" srcSet={heroDesktop} />}
                <img
                  src={heroMobile || heroDesktop || ''}
                  alt={category.name}
                  className="w-full max-h-72 object-cover rounded-xl border border-border-default"
                />
              </picture>
            )
            const link: string = category.banner_link_url || ''
            if (!/^(https?:\/\/|\/)/.test(link)) return hero
            return link.startsWith('/') ? (
              <Link href={link} className="block">{hero}</Link>
            ) : (
              <a href={link} target="_blank" rel="noopener noreferrer" className="block">{hero}</a>
            )
          })()}
        </div>
      ) : null}

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
                    {subcategory.image_url ? (
                      <img
                        src={subcategory.image_url}
                        alt=""
                        loading="lazy"
                        className="w-9 h-9 sm:w-11 sm:h-11 rounded-lg object-cover border border-border-default shrink-0"
                      />
                    ) : (
                      <div className="w-9 h-9 sm:w-11 sm:h-11 bg-accent-100 rounded-lg flex items-center justify-center group-hover:bg-accent-200 transition-colors shrink-0">
                        <CategoryIcon
                          iconName={subcategory.icon_name}
                          categoryName={subcategory.name}
                          className="w-5 h-5 sm:w-6 sm:h-6 text-accent-600 group-hover:text-accent-700"
                        />
                      </div>
                    )}
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
              pagedItems={pagedItems}
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
        <SeoContent text={category.seo_content} />
        <CategoryFaqs faqs={faqs} />
      </div>
    </div>
  )
}
