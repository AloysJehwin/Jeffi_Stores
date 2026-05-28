import { notFound } from 'next/navigation'
import Link from 'next/link'
import { cache } from 'react'
import type { Metadata } from 'next'
import { queryOne, queryMany } from '@/lib/db'
import { VARIANT_MIN_PRICE_SQL, VARIANT_STOCK_TOTAL_SQL } from '@/lib/queries'
import ProductDetailClient from '@/components/visitor/ProductDetailClient'
import ProductReviews from '@/components/visitor/ProductReviews'
import ImgWithSkeleton from '@/components/ui/ImgWithSkeleton'
import TrackRecentlyViewed from '@/components/visitor/TrackRecentlyViewed'
import RecentlyViewed from '@/components/visitor/RecentlyViewed'

const getProductBySlug = cache(async (slug: string) => {
  return queryOne(`
    SELECT p.*,
      json_build_object('id', c.id, 'name', c.name, 'slug', c.slug,
        'return_allowed', c.return_allowed, 'return_window_days', c.return_window_days,
        'replacement_allowed', c.replacement_allowed, 'replacement_window_days', c.replacement_window_days
      ) AS categories,
      json_build_object('id', b.id, 'name', b.name, 'slug', b.slug) AS brands,
      COALESCE(
        (SELECT json_agg(pi ORDER BY pi.display_order)
         FROM product_images pi WHERE pi.product_id = p.id),
        '[]'::json
      ) AS product_images,
      COALESCE(
        (SELECT json_agg(
           jsonb_build_object(
             'id', pv.id, 'variant_name', pv.variant_name, 'sku', pv.sku,
             'price', pv.price, 'mrp', pv.mrp, 'price_ex_gst', pv.price_ex_gst,
             'wholeprice_ex_gst', pv.wholeprice_ex_gst, 'stock_quantity', pv.stock_quantity,
             'pricing_type', pv.pricing_type, 'unit', pv.unit, 'numeric_value', pv.numeric_value,
             'weight_rate', pv.weight_rate, 'weight_unit', pv.weight_unit,
             'length_rate', pv.length_rate, 'length_unit', pv.length_unit,
             'sub_variant_type', pv.sub_variant_type,
             'variant_type', pv.variant_type,
             'variant_images', COALESCE(
               (SELECT json_agg(vi ORDER BY vi.display_order)
                FROM variant_images vi WHERE vi.variant_id = pv.id),
               '[]'::json
             ),
             'sub_variants', COALESCE(
               (SELECT json_agg(sv ORDER BY sv.sub_variant_name)
                FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true),
               '[]'::json
             )
           ) ORDER BY pv.variant_name
         )
         FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true),
        '[]'::json
      ) AS product_variants,
      ${VARIANT_MIN_PRICE_SQL} AS variant_min_price,
      ${VARIANT_STOCK_TOTAL_SQL} AS variant_stock_total
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE p.slug = $1 AND p.is_active = true
  `, [slug])
})

export async function generateMetadata({
  params,
}: {
  params: { slug: string }
}): Promise<Metadata> {
  const product = await getProductBySlug(params.slug)
  if (!product) return { title: 'Product Not Found' }

  const primaryImage = product.product_images?.find((img: any) => img.is_primary) || product.product_images?.[0]
  const displayPrice = product.has_variants && product.variant_min_price
    ? product.variant_min_price
    : (product.base_price || 0)
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://jeffistoress.com'

  return {
    title: `${product.name} | Jeffi Stores`,
    description: product.description?.slice(0, 160) || `Buy ${product.name} at Jeffi Stores`,
    openGraph: {
      title: product.name,
      description: product.description?.slice(0, 160) || `Buy ${product.name} at Jeffi Stores`,
      url: `${baseUrl}/products/${product.slug}`,
      images: primaryImage ? [{ url: primaryImage.image_url, alt: product.name }] : [],
      type: 'website',
    },
    other: {
      'product:price:amount': String(Number(displayPrice)),
      'product:price:currency': 'INR',
    },
  }
}

function buildProductJsonLd(product: any, baseUrl: string) {
  const images = (product.product_images || []).map((img: any) => img.image_url)
  const hasVariants = product.has_variants && product.product_variants?.length > 0

  const offers = hasVariants
    ? product.product_variants.map((v: any) => {
        const price = v.price
        return {
          '@type': 'Offer',
          name: v.variant_name,
          sku: v.sku,
          ...(v.mpn && { mpn: v.mpn }),
          ...(v.gtin && { gtin: v.gtin }),
          price: price != null ? Number(price) : undefined,
          priceCurrency: 'INR',
          availability: v.stock_quantity > 0
            ? 'https://schema.org/InStock'
            : 'https://schema.org/OutOfStock',
          itemCondition: 'https://schema.org/NewCondition',
          url: `${baseUrl}/products/${product.slug}?sku=${encodeURIComponent(v.sku)}`,
        }
      })
    : [
        {
          '@type': 'Offer',
          sku: product.sku,
          price: Number(product.base_price),
          priceCurrency: 'INR',
          availability: product.stock_quantity > 0
            ? 'https://schema.org/InStock'
            : 'https://schema.org/OutOfStock',
          itemCondition: 'https://schema.org/NewCondition',
          url: `${baseUrl}/products/${product.slug}`,
        },
      ]

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description || undefined,
    sku: product.sku,
    ...(product.mpn && { mpn: product.mpn }),
    ...(product.gtin && { gtin: product.gtin }),
    image: images.length > 0 ? images : undefined,
    ...(product.brands && { brand: { '@type': 'Brand', name: product.brands.name } }),
    ...(product.categories && { category: product.categories.name }),
    offers: hasVariants
      ? { '@type': 'AggregateOffer', offerCount: offers.length, offers }
      : offers[0],
  }
}

async function getRelatedProducts(productId: string, categoryId: string) {
  return queryMany(`
    SELECT p.*,
      json_build_object('id', c.id, 'name', c.name, 'slug', c.slug) AS categories,
      json_build_object('id', b.id, 'name', b.name) AS brands,
      COALESCE(
        (SELECT json_agg(pi ORDER BY pi.display_order)
         FROM product_images pi WHERE pi.product_id = p.id),
        '[]'::json
      ) AS product_images,
      ${VARIANT_STOCK_TOTAL_SQL} AS variant_stock_total,
      ${VARIANT_MIN_PRICE_SQL} AS variant_min_price
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE p.category_id = $1 AND p.is_active = true AND p.id != $2
    LIMIT 4
  `, [categoryId, productId])
}

export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: { slug: string }
  searchParams: { [key: string]: string | string[] | undefined }
}) {
  const product = await getProductBySlug(params.slug)

  if (!product) {
    notFound()
  }

  const relatedProducts = await getRelatedProducts(product.id, product.category_id)
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://jeffistoress.com'
  const jsonLd = buildProductJsonLd(product, baseUrl)
  const skuParam = typeof searchParams.sku === 'string' ? searchParams.sku : undefined

  const primaryImage = product.product_images?.find((img: any) => img.is_primary) || product.product_images?.[0]
  const hasVariants = product.has_variants && product.product_variants?.length > 0
  const displayPrice = hasVariants && product.variant_min_price
    ? product.variant_min_price
    : (product.base_price || 0)
  const mrp = product.mrp ? Number(product.mrp) : null
  const mrpDiscount = mrp && mrp > Number(displayPrice)
    ? Math.round(((mrp - Number(displayPrice)) / mrp) * 100)
    : 0

  return (
    <div className="bg-surface min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <TrackRecentlyViewed
        id={product.id}
        name={product.name}
        slug={product.slug}
        price={Number(displayPrice)}
        image={primaryImage?.thumbnail_url || primaryImage?.image_url || null}
      />
      {/* Breadcrumb */}
      <div className="bg-surface-elevated border-b border-border-default">
        <div className="container mx-auto px-4 py-4">
          <nav className="flex items-center gap-2 text-sm">
            <Link href="/" className="text-foreground-muted hover:text-accent-500 whitespace-nowrap">
              Home
            </Link>
            <span className="text-foreground-muted">/</span>
            <Link href="/products" className="text-foreground-muted hover:text-accent-500 whitespace-nowrap">
              Products
            </Link>
            {product.categories && (
              <>
                <span className="text-foreground-muted">/</span>
                <Link
                  href={`/categories/${product.categories.slug}`}
                  className="text-foreground-muted hover:text-accent-500 whitespace-nowrap hidden sm:inline"
                >
                  {product.categories.name}
                </Link>
                <span className="text-foreground-muted sm:hidden">...</span>
              </>
            )}
            <span className="text-foreground-muted hidden sm:inline">/</span>
            <span className="text-foreground font-medium truncate hidden sm:inline">{product.name}</span>
          </nav>
        </div>
      </div>

      <div className="container mx-auto px-4 py-4 sm:py-6 lg:py-8">
        {/* Product Details */}
        <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden mb-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 lg:gap-8 p-4 sm:p-6 lg:p-8 lg:items-start">
            <ProductDetailClient product={product} initialSkuParam={skuParam} />
          </div>

          {/* Description */}
          {product.description && (
            <div className="border-t border-border-default p-4 sm:p-6 lg:p-8">
              <h2 className="text-2xl font-bold text-foreground mb-4">Product Description</h2>
              <p className="text-foreground-secondary leading-relaxed whitespace-pre-line">
                {product.description}
              </p>
            </div>
          )}
        </div>

        {/* Product Reviews */}
        <ProductReviews productId={product.id} productName={product.name} />

        {/* Recently Viewed */}
        <RecentlyViewed excludeId={product.id} />

        {/* Related Products */}
        {relatedProducts.length > 0 && (
          <div>
            <h2 className="text-2xl font-bold text-foreground mb-6">Related Products</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {relatedProducts.map((relatedProduct) => {
                const relatedPrimaryImage = relatedProduct.product_images?.find((img: any) => img.is_primary) || relatedProduct.product_images?.[0]
                const relatedHasVariants = relatedProduct.has_variants
                const relatedDisplayPrice = relatedHasVariants && relatedProduct.variant_min_price
                  ? relatedProduct.variant_min_price
                  : (relatedProduct.base_price)
                const relatedMrp = relatedProduct.mrp ? Number(relatedProduct.mrp) : null
                const relatedMrpDiscount = relatedMrp && relatedMrp > Number(relatedDisplayPrice)
                  ? Math.round(((relatedMrp - Number(relatedDisplayPrice)) / relatedMrp) * 100)
                  : 0

                return (
                  <Link
                    key={relatedProduct.id}
                    href={`/products/${relatedProduct.slug}`}
                    className="group"
                  >
                    <div className="flex flex-col h-full bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden hover:shadow-lg transition-shadow">
                      <div className="relative aspect-square border-2 border-gray-300 dark:border-gray-600 overflow-hidden rounded-lg mx-3 mt-3">
                        {relatedPrimaryImage ? (
                          <>
                            <img
                              src={relatedPrimaryImage.image_url}
                              alt=""
                              aria-hidden="true"
                              className="absolute inset-0 w-full h-full object-cover scale-110 blur-xl opacity-60"
                            />
                            <div className="relative w-full h-full">
                              <ImgWithSkeleton
                                src={relatedPrimaryImage.image_url}
                                alt={relatedProduct.name}
                                className="w-full h-full object-contain"
                              />
                            </div>
                          </>
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <svg className="w-16 h-16 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          </div>
                        )}
                        {relatedMrpDiscount > 0 && (
                          <div className="absolute top-2 right-2 bg-accent-500 text-white px-2 py-0.5 rounded-full text-xs font-semibold">
                            {relatedMrpDiscount}% off
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col flex-1 p-4">
                        <h3 className="font-semibold text-sm text-foreground mb-2 group-hover:text-accent-600 transition-colors line-clamp-2 flex-1">
                          {relatedProduct.name}
                        </h3>
                        <div className="flex items-baseline gap-2">
                          <span className="text-base font-bold text-primary-600 dark:text-primary-400">
                            {relatedHasVariants ? 'From ' : ''}₹{Number(relatedDisplayPrice).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </span>
                          {relatedMrp && relatedMrp > Number(relatedDisplayPrice) && (
                            <span className="text-xs text-foreground-muted line-through">
                              ₹{relatedMrp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
