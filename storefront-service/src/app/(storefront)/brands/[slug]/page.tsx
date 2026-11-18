import { notFound } from 'next/navigation'
import Link from 'next/link'
import { cache } from 'react'
import type { Metadata } from 'next'
import { breadcrumbJsonLd, ldJson, listingMetadata } from '@/lib/catalog/listing-seo'
import { siteOrigin } from '@/app-shell/site-origin'
import { responsiveImg } from '@/lib/shared/image-url'
import { queryOne, queryMany } from '@/lib/shared/db'
import {
  VARIANT_MIN_PRICE_INCL_GST_SQL,
  VARIANT_MIN_PRICE_EX_GST_SQL,
  VARIANT_MIN_MRP_SQL,
  VARIANT_STOCK_TOTAL_SQL,
} from '@/lib/queries'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { pickUnitPrice } from '@/lib/catalog/pricing'
import ProductCard from '@/components/visitor/ProductCard'
import { EAGER_CARDS, ListingPagedItems, productPageItems, withListingSections, type PagedItem } from '@/components/visitor/listing/listing-sections'
import { loadPartsPage } from '@/components/visitor/site/code/parts/taxonomy/site-page'
import ListingPageParts from '@/components/visitor/site/code/parts/listing/ListingPageParts'
import type { ListingPartsData } from '@/components/visitor/site/code/parts/listing/context'
import { previewRows } from '@/lib/site/preview'
import { LISTING_PAGE_SIZE, buildListingModel, getListingProducts } from '@/lib/catalog/listing-model'
import { brandPageView, brandProductCount } from '@/lib/site/data/taxonomy'
import { round2 } from '@/lib/catalog/gst'
import { positiveInt, productOrderBy, type ProductSortQuery } from '@/lib/catalog/product-sort'
import SortDropdown from '@/components/visitor/SortDropdown'
import { publicProducts } from '@/lib/catalog/public-product'
import {
  BrandAccentBar,
  BrandBanner,
  BrandFacts,
  BrandSocialLinks,
  BrandStory,
  BrandWarrantyService,
  SeoContent,
  brandSocialLinks,
} from '@/components/visitor/brand/BrandProfile'

const PAGE_SIZE = 25

const getBrandBySlug = cache(async (slug: string) =>
  queryOne('SELECT * FROM brands WHERE slug = $1 AND is_active = true LIMIT 1', [slug])
)

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const brand = await getBrandBySlug(slug)
  if (!brand) return { title: 'Brand Not Found' }
  return listingMetadata({
    title: brand.meta_title || brand.name,
    description: brand.meta_description || brand.description,
    fallbackDescription: `Shop ${brand.name} products.`,
    path: `/brands/${brand.slug}`,
    image: brand.banner_desktop_url || brand.logo_url,
    noindex: brand.seo_noindex === true,
  })
}

async function getBrandProducts(brandId: string, page: number, gstEnabled: boolean, sort: ProductSortQuery) {
  const offset = (page - 1) * PAGE_SIZE
  const countRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM products WHERE brand_id = $1 AND is_active = true`,
    [brandId]
  )
  const total = parseInt(countRow?.total || '0', 10)

  const MIN_PRICE_SQL = gstEnabled ? VARIANT_MIN_PRICE_INCL_GST_SQL : VARIANT_MIN_PRICE_EX_GST_SQL

  const products = await queryMany(
    `
    SELECT p.*,
      json_build_object('id', c.id, 'name', c.name, 'slug', c.slug) AS categories,
      json_build_object('id', b.id, 'name', b.name) AS brands,
      COALESCE(
        (SELECT json_agg(pi ORDER BY pi.display_order)
         FROM product_images pi WHERE pi.product_id = p.id),
        '[]'::json
      ) AS product_images,
      ${VARIANT_STOCK_TOTAL_SQL} AS variant_stock_total,
      ${MIN_PRICE_SQL} AS variant_min_price,
      ${VARIANT_MIN_MRP_SQL} AS variant_min_mrp
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN categories pc ON c.parent_category_id = pc.id
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE p.brand_id = $1 AND p.is_active = true
    ORDER BY ${productOrderBy(sort, { gstEnabled })}
    LIMIT $2 OFFSET $3
  `,
    [brandId, PAGE_SIZE, offset]
  )

  return { products: publicProducts(products), total }
}

/** The categories holding the brand's products, for its listing's category filter. */
async function getBrandCategories(brandId: string) {
  return queryMany<{ id: string; name: string }>(
    `SELECT DISTINCT c.id, c.name, c.display_order FROM products p JOIN categories c ON c.id = p.category_id AND c.is_active = true
      WHERE p.brand_id = $1 AND p.is_active = true ORDER BY c.display_order, c.name`,
    [brandId]
  )
}

const GRID = 'grid grid-flow-row-dense grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-6'
const filled = (...vs: unknown[]) => vs.some(v => (typeof v === 'string' ? v.trim() !== '' : v != null))

/** One product card of the brand's listing (its own MRP rule: the product's, else its cheapest variant's). */
function brandItem(product: any, gstEnabled: boolean, deferred: boolean): PagedItem {
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
  const rawMrp = product.mrp
    ? Number(product.mrp)
    : product.variant_min_mrp
      ? Number(product.variant_min_mrp)
      : null
  const gstRate = Number(product.gst_percentage ?? 0)
  // When GST is off, displayPrice is ex-GST — put MRP on the same ex-GST basis before computing the discount and passing it to the card.
  const mrp =
    !gstEnabled && rawMrp != null && gstRate > 0 ? round2(rawMrp / (1 + gstRate / 100)) : rawMrp
  const priceForDiscount = Number(displayPrice)
  const mrpDiscount =
    mrp && mrp > priceForDiscount ? Math.round(((mrp - priceForDiscount) / mrp) * 100) : 0

  return {
    key: String(product.id),
    node: (
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
        brandName={product.brands?.name || null}
        categoryName={product.categories?.name || null}
        discountPct={Number(product.discount_pct ?? 0)}
        extraDeliveryDays={Number(product.extra_delivery_days ?? 0)}
        handlingDays={Number(product.handling_days ?? 2)}
        deferred={deferred}
      />
    ),
  }
}

export default async function BrandDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { slug } = await params
  const resolvedSearchParams = await searchParams
  const brand = await getBrandBySlug(slug)

  if (!brand) {
    notFound()
  }

  const sp: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(resolvedSearchParams)) sp[k] = Array.isArray(v) ? v[0] : v
  const page = positiveInt(sp.page, 1)
  const [{ gstEnabled }, sitePage, { surface, draft }] = await Promise.all([
    getFeatureFlags(),
    loadPartsPage({ audience: 'store', page: 'brand' }, { preview: sp.preview, layout: sp.layout }, 'listing_main', ['ProductResults']),
    previewRows(sp.preview, sp.layout),
  ])
  // What the AI design places replaces the built-in piece; the rest stays around it, so nothing is lost.
  const own = sitePage.has
  const code = !!sitePage.parts
  // The built-in list (its own page size and price rule), only where it shows.
  const { products, total } = sitePage.builtIn ? await getBrandProducts(brand.id, page, gstEnabled, sp) : { products: [] as any[], total: 0 }
  const brandId = brand.id
  async function loadPage(p: number) {
    'use server'
    const flags = await getFeatureFlags()
    const next = await getBrandProducts(brandId, p, flags.gstEnabled, sp)
    const rows = await withListingSections(
      next.products.map((product: any) => brandItem(product, flags.gstEnabled, true)),
      { page: 'brand', surface, pageNum: p, pageSize: PAGE_SIZE, total: next.total }
    )
    return { rows, total: next.total }
  }
  // An AI design lists the brand through the store's listing, so its filters work here too.
  const listingSp = { ...sp, brand: String(brandId) }
  const [listing, brandCategories] = code
    ? await Promise.all([buildListingModel(listingSp, { categoryBanners: false }), getBrandCategories(String(brandId))])
    : ([null, []] as [null, { id: string; name: string }[]])
  async function loadListingPage(p: number) {
    'use server'
    const next = await getListingProducts({ ...listingSp, page: String(p) })
    const rows = await productPageItems(next.products, next.gstEnabled, { page: 'brand', surface, pageNum: p, pageSize: LISTING_PAGE_SIZE, total: next.total })
    return { rows, total: next.total }
  }
  const filtered = Object.entries(sp).some(([k, v]) => !!v && !['page', 'sort', 'dir', 'order', 'layout', 'preview'].includes(k))
  const view = code ? brandPageView(brand, listing && !filtered ? listing.total : await brandProductCount(String(brandId))) : null
  const crumbLd = await breadcrumbJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Brands', path: '/brands' },
    { name: brand.name },
  ])
  const sameAs = [brand.website, ...brandSocialLinks(brand.social_links).map(([, url]) => url)].filter(Boolean)
  const brandLd = {
    '@context': 'https://schema.org',
    '@type': 'Brand',
    name: brand.name,
    url: `${await siteOrigin()}/brands/${brand.slug}`,
    ...(brand.logo_url ? { logo: brand.logo_url } : {}),
    ...(brand.description ? { description: brand.description } : {}),
    ...(sameAs.length ? { sameAs } : {}),
  }

  // The design's Brand replaces the built-in header, banner and story; its Breadcrumbs (or Brand) the breadcrumb.
  const ownTitle = own('Brand')
  const ownTrail = ownTitle || own('Breadcrumbs')
  const story = ownTitle ? null : <BrandStory brand={brand} />
  const warranty = <BrandWarrantyService brand={brand} />
  const seo = own('SeoText') ? null : <SeoContent text={brand.seo_content} />

  // The listing itself. With a Site Builder layout it is the page's `listing_main` block, with the store's blocks
  // above and below it; otherwise it is the page.
  const main = (
        <div className="container mx-auto px-4 py-4 sm:py-6 lg:py-8">
          {story}
          {warranty}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
              <h2 className="text-xl font-bold text-foreground">Products ({total})</h2>
              {total > 1 && <SortDropdown basePath={`/brands/${brand.slug}`} />}
            </div>

            {products.length > 0 ? (
              <>
                <ListingPagedItems
                  items={products.map((product, i) => brandItem(product, gstEnabled, i >= EAGER_CARDS))}
                  loadPage={loadPage}
                  listing={{ page: 'brand', surface, pageNum: page, pageSize: PAGE_SIZE, total, draft }}
                  page={page}
                  total={total}
                  noun="products"
                  wrap="div"
                  wrapClassName="grid grid-flow-row-dense grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-6"
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
                <h3 className="text-xl font-semibold text-foreground mb-2">No Products Yet</h3>
                <p className="text-foreground-secondary mb-6">
                  We&apos;re working on adding products for this brand. Check back soon!
                </p>
                <Link
                  href="/products"
                  className="inline-block bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
                >
                  Browse All Products
                </Link>
              </div>
            )}
          </div>
          {seo}
        </div>
  )
  const site = sitePage.site(main)
  // Without the built-in listing, what the design leaves out shows around it: the story and warranty above (the
  // warranty below a design that has its own header), the SEO copy below.
  const around = !!site && !sitePage.builtIn
  const hasWarranty = filled(brand.default_warranty_months, brand.default_warranty_type, brand.warranty_terms, brand.service_phone, brand.service_email, brand.service_url, brand.catalogue_pdf_url)
  const before = around && !ownTitle && (filled(brand.story) || hasWarranty)
  const after = around && ((ownTitle && hasWarranty) || (!!seo && filled(brand.seo_content)))
  const brandListing = { page: 'brand' as const, surface, pageNum: page, pageSize: PAGE_SIZE, total, draft }
  const data: ListingPartsData = listing
    ? {
        kind: 'brand',
        basePath: `/brands/${brand.slug}`,
        portal: 'storefront',
        productBase: '/products',
        products: listing.products,
        gstEnabled: listing.gstEnabled,
        total: listing.total,
        page: listing.page,
        pageSize: LISTING_PAGE_SIZE,
        pagedItems: await productPageItems(listing.products, listing.gstEnabled, { page: 'brand', surface, pageNum: listing.page, pageSize: LISTING_PAGE_SIZE, total: listing.total, draft }, EAGER_CARDS),
        loadPage: loadListingPage,
        sections: { page: 'brand', surface, pageNum: listing.page, pageSize: LISTING_PAGE_SIZE, total: listing.total, draft },
        // The brand is fixed here: its filter is left out, its categories narrow the list.
        filters: {
          facets: { ...listing.facets, brands: [] },
          categories: brandCategories.map(c => ({ id: String(c.id), name: c.name, parent_category_id: null })),
          brands: [],
          offers: listing.filterOffers,
        },
        grid: GRID,
        brand: view,
      }
    : {
        kind: 'brand',
        basePath: `/brands/${brand.slug}`,
        portal: 'storefront',
        productBase: '/products',
        products,
        gstEnabled,
        total,
        page,
        pageSize: PAGE_SIZE,
        pagedItems: [],
        loadPage,
        sections: brandListing,
        filters: null,
        grid: GRID,
      }

  return (
    <div className="bg-surface min-h-screen">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson([crumbLd, brandLd]) }} />
      <BrandAccentBar color={brand.brand_color} />
      {!ownTitle && (
      <div className="bg-surface-elevated border-b border-border-default">
        <div className="container mx-auto px-4 py-4">
          {!ownTrail && (
          <nav className="flex items-center gap-2 text-sm mb-4">
            <Link href="/" className="text-foreground-muted hover:text-accent-500">
              Home
            </Link>
            <span className="text-foreground-muted">/</span>
            <Link href="/brands" className="text-foreground-muted hover:text-accent-500">
              Brands
            </Link>
            <span className="text-foreground-muted">/</span>
            <span className="text-foreground font-medium">{brand.name}</span>
          </nav>
          )}

          <div className="flex items-center gap-4">
            {brand.logo_url && (
              <div className="w-16 h-16 bg-surface-secondary rounded-lg border border-border-default overflow-hidden flex-shrink-0">
                <img
                  {...responsiveImg(brand.logo_url, '64px')}
                  alt={brand.name}
                  className="w-full h-full object-contain p-1"
                />
              </div>
            )}
            <div>
              <h1 className="text-3xl md:text-4xl font-bold text-secondary-500 dark:text-foreground mb-2">
                {brand.name}
              </h1>
              {brand.tagline && <p className="text-lg text-foreground font-medium mb-1">{brand.tagline}</p>}
              {brand.description && <p className="text-foreground-secondary">{brand.description}</p>}
              {brand.website && (
                <a
                  href={brand.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-accent-500 hover:text-accent-600 mt-1 inline-block"
                >
                  {brand.website}
                </a>
              )}
              <div className="mt-3 flex flex-col gap-2">
                <BrandFacts brand={brand} />
                <BrandSocialLinks brand={brand} />
              </div>
            </div>
          </div>
        </div>
      </div>
      )}

      {!ownTitle && <BrandBanner brand={brand} />}

      <ListingPageParts data={data}>
        {site ? (
          <>
            {before && (
              <div className="container mx-auto px-4 pt-4 sm:pt-6">
                {story}
                {warranty}
              </div>
            )}
            {site}
            {after && (
              <div className="container mx-auto px-4 pb-8">
                {ownTitle && warranty}
                {seo}
              </div>
            )}
          </>
        ) : (
          main
        )}
      </ListingPageParts>
    </div>
  )
}
