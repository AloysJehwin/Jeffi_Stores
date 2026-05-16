import { notFound } from 'next/navigation'
import Link from 'next/link'
import { cache } from 'react'
import type { Metadata } from 'next'
import { queryOne, queryMany } from '@/lib/db'
import ProductImageGallery from '@/components/visitor/ProductImageGallery'
import ProductActions from '@/components/visitor/ProductActions'
import ProductReviews from '@/components/visitor/ProductReviews'
import ImgWithSkeleton from '@/components/ui/ImgWithSkeleton'
import TrackRecentlyViewed from '@/components/visitor/TrackRecentlyViewed'
import RecentlyViewed from '@/components/visitor/RecentlyViewed'

const getProductBySlug = cache(async (slug: string) => {
  return queryOne(`
    SELECT p.*,
      json_build_object('id', c.id, 'name', c.name, 'slug', c.slug) AS categories,
      json_build_object('id', b.id, 'name', b.name, 'slug', b.slug) AS brands,
      COALESCE(
        (SELECT json_agg(pi ORDER BY pi.display_order)
         FROM product_images pi WHERE pi.product_id = p.id),
        '[]'::json
      ) AS product_images,
      COALESCE(
        (SELECT json_agg(pv ORDER BY pv.variant_name)
         FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true),
        '[]'::json
      ) AS product_variants
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
  const displayPrice = product.sale_price || product.base_price
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
        const price = v.sale_price ?? v.price
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
          price: Number(product.sale_price || product.base_price),
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
      COALESCE((SELECT SUM(pv.stock_quantity) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true), 0) AS variant_stock_total,
      (SELECT MIN(COALESCE(pv.sale_price, pv.price)) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true AND (pv.price IS NOT NULL OR pv.sale_price IS NOT NULL)) AS variant_min_price
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
  const displayPrice = product.sale_price || product.base_price
  const mrp = product.mrp ? Number(product.mrp) : null
  const mrpDiscount = mrp && mrp > Number(displayPrice)
    ? Math.round(((mrp - Number(displayPrice)) / mrp) * 100)
    : 0

  return (
    <div className="bg-surface min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
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
            {/* Product Images — order-1 on mobile, natural on desktop */}
            <div className="order-1 lg:order-none">
              <ProductImageGallery
                images={product.product_images || []}
                productName={product.name}
              />

              {/* Delivery & Returns — hidden on mobile (shown after product info via order-3 div below) */}
              <div className="hidden lg:block mt-4 bg-surface rounded-lg border border-border-default p-4">
                <div className="grid grid-cols-1 gap-3">
                  <div className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-accent-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8l1 12a2 2 0 002 2h8a2 2 0 002-2L19 8M10 12v4m4-4v4" />
                    </svg>
                    <div>
                      <p className="text-sm font-semibold text-foreground">Free Delivery</p>
                      <p className="text-xs text-foreground-secondary">On orders above ₹500</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-accent-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <div>
                      <p className="text-sm font-semibold text-foreground">Easy Returns</p>
                      <p className="text-xs text-foreground-secondary">7-day hassle-free return policy</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-accent-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    <div>
                      <p className="text-sm font-semibold text-foreground">100% Genuine</p>
                      <p className="text-xs text-foreground-secondary">Authentic products guaranteed</p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="hidden lg:block mt-3 bg-surface rounded-lg border border-border-default px-4 py-3">
                <p className="text-xs text-foreground-secondary text-center mb-2">Secure Payment Options</p>
                <div className="flex items-center justify-center gap-3 flex-wrap">
                  {['UPI', 'Cards', 'Net Banking', 'Wallets'].map((method) => (
                    <span key={method} className="text-xs font-medium bg-surface-elevated border border-border-default text-foreground-secondary px-2 py-1 rounded">
                      {method}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Product Info — order-2 on mobile, natural on desktop */}
            <div className="order-2 lg:order-none">

              <h1 className="text-3xl font-bold text-foreground mb-4">
                {product.name}
              </h1>

              {/* Brand */}
              <div className="flex items-center gap-4 mb-4 text-sm">
                {product.brands && (
                  <span className="text-foreground-secondary">
                    Brand: <span className="font-medium text-foreground">{product.brands.name}</span>
                  </span>
                )}
              </div>

              {/* Price & Stock — shown inline for non-variant products */}
              {!hasVariants && (
                <>
                  <div className="bg-surface rounded-lg p-4 sm:p-6 mb-6">
                    <div className="flex items-baseline gap-3 mb-2">
                      <span className="text-4xl font-bold text-primary-600 dark:text-primary-400">
                        Rs. {Number(displayPrice).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                      {mrp && mrp > Number(displayPrice) && (
                        <span className="text-xl text-foreground-muted line-through">
                          Rs. {mrp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>
                      )}
                    </div>
                    {mrpDiscount > 0 && (
                      <div className="flex items-center gap-2 mb-2">
                        <span className="bg-accent-100 text-accent-700 dark:text-accent-400 px-3 py-1 rounded-full text-sm font-semibold">
                          {mrpDiscount}% off
                        </span>
                        <span className="text-sm text-foreground-secondary">
                          You save Rs. {(mrp! - Number(displayPrice)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    )}
                    <p className="text-xs text-foreground-muted">
                      Inclusive of all taxes
                      {product.gst_percentage ? ` (${parseFloat(product.gst_percentage)}% GST)` : ''}
                    </p>
                    {product.wholesale_price && (
                      <div className="mt-3 pt-3 border-t border-border-default">
                        <span className="text-sm text-foreground-secondary">
                          Wholesale Price: <span className="font-semibold text-foreground">Rs. {Number(product.wholesale_price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="mb-6">
                    {product.stock_quantity > 0 ? (
                      <div className="flex items-center gap-2">
                        <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        <span className="text-green-700 dark:text-green-400 font-semibold">
                          In Stock{product.stock_quantity < 10 ? ` (${product.stock_quantity} left)` : ''}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <svg className="w-5 h-5 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                        </svg>
                        <span className="text-red-700 dark:text-red-400 font-semibold">Out of Stock</span>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Product Actions (includes variant selector + price/stock for variant products) */}
              <ProductActions
                productId={product.id}
                productName={product.name}
                sku={product.sku}
                stockQuantity={product.stock_quantity}
                basePrice={Number(product.base_price)}
                salePrice={product.sale_price ? Number(product.sale_price) : null}
                mrp={mrp}
                gstPercentage={product.gst_percentage ? Number(product.gst_percentage) : null}
                wholesalePrice={product.wholesale_price ? Number(product.wholesale_price) : null}
                variants={hasVariants ? product.product_variants : []}
                variantType={product.variant_type || 'Variant'}
                initialSkuParam={skuParam}
                weightRate={product.weight_rate ? Number(product.weight_rate) : null}
                weightUnit={product.weight_unit || null}
                lengthRate={product.length_rate ? Number(product.length_rate) : null}
                lengthUnit={product.length_unit || null}
              />

              {/* Product Specifications */}
              <div className="mt-6 pt-6 border-t border-border-default">
                <h3 className="font-semibold text-foreground mb-3">Product Specifications</h3>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  {product.weight && (
                    <>
                      <dt className="text-foreground-secondary">Weight:</dt>
                      <dd className="font-medium text-foreground">{product.weight} kg</dd>
                    </>
                  )}
                  {product.dimensions && (
                    <>
                      <dt className="text-foreground-secondary">Dimensions:</dt>
                      <dd className="font-medium text-foreground">{product.dimensions} cm</dd>
                    </>
                  )}
                  {product.categories && (
                    <>
                      <dt className="text-foreground-secondary">Category:</dt>
                      <dd className="font-medium text-foreground">{product.categories.name}</dd>
                    </>
                  )}
                  {product.brands && (
                    <>
                      <dt className="text-foreground-secondary">Brand:</dt>
                      <dd className="font-medium text-foreground">{product.brands.name}</dd>
                    </>
                  )}
                </dl>
              </div>
            </div>

            {/* Delivery & Returns + Secure Payment — mobile only (desktop version is inside image column above) */}
            <div className="order-3 lg:hidden">
              <div className="bg-surface rounded-lg border border-border-default p-4">
                <div className="grid grid-cols-1 gap-3">
                  <div className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-accent-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8l1 12a2 2 0 002 2h8a2 2 0 002-2L19 8M10 12v4m4-4v4" />
                    </svg>
                    <div>
                      <p className="text-sm font-semibold text-foreground">Free Delivery</p>
                      <p className="text-xs text-foreground-secondary">On orders above ₹500</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-accent-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <div>
                      <p className="text-sm font-semibold text-foreground">Easy Returns</p>
                      <p className="text-xs text-foreground-secondary">7-day hassle-free return policy</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-accent-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    <div>
                      <p className="text-sm font-semibold text-foreground">100% Genuine</p>
                      <p className="text-xs text-foreground-secondary">Authentic products guaranteed</p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-3 bg-surface rounded-lg border border-border-default px-4 py-3">
                <p className="text-xs text-foreground-secondary text-center mb-2">Secure Payment Options</p>
                <div className="flex items-center justify-center gap-3 flex-wrap">
                  {['UPI', 'Cards', 'Net Banking', 'Wallets'].map((method) => (
                    <span key={method} className="text-xs font-medium bg-surface-elevated border border-border-default text-foreground-secondary px-2 py-1 rounded">
                      {method}
                    </span>
                  ))}
                </div>
              </div>
            </div>
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
                  : (relatedProduct.sale_price || relatedProduct.base_price)
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
                    <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden hover:shadow-lg transition-shadow">
                      <div className="relative aspect-[5/3] border-2 border-gray-300 dark:border-gray-600 overflow-hidden rounded-lg mx-3 mt-3">
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
                      <div className="p-4">
                        <h3 className="font-semibold text-sm text-foreground mb-2 group-hover:text-accent-600 transition-colors line-clamp-2">
                          {relatedProduct.name}
                        </h3>
                        <div className="flex items-baseline gap-2">
                          <span className="text-lg font-bold text-primary-600 dark:text-primary-400">
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
