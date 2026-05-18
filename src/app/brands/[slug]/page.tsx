import { notFound } from 'next/navigation'
import Link from 'next/link'
import { queryOne, queryMany } from '@/lib/db'

async function getBrandBySlug(slug: string) {
  return queryOne(
    'SELECT * FROM brands WHERE slug = $1 AND is_active = true LIMIT 1',
    [slug]
  )
}

async function getBrandProducts(brandId: string) {
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
    WHERE p.brand_id = $1 AND p.is_active = true
    ORDER BY p.created_at DESC
  `, [brandId])
}

export default async function BrandDetailPage({
  params,
}: {
  params: { slug: string }
}) {
  const brand = await getBrandBySlug(params.slug)

  if (!brand) {
    notFound()
  }

  const products = await getBrandProducts(brand.id)

  return (
    <div className="bg-surface min-h-screen">
      <div className="bg-surface-elevated border-b border-border-default">
        <div className="container mx-auto px-4 py-4">
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

          <div className="flex items-center gap-4">
            {brand.logo_url && (
              <div className="w-16 h-16 bg-surface-secondary rounded-lg border border-border-default overflow-hidden flex-shrink-0">
                <img src={brand.logo_url} alt={brand.name} className="w-full h-full object-contain p-1" />
              </div>
            )}
            <div>
              <h1 className="text-3xl md:text-4xl font-bold text-secondary-500 dark:text-foreground mb-2">
                {brand.name}
              </h1>
              {brand.description && (
                <p className="text-foreground-secondary">{brand.description}</p>
              )}
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
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-4 sm:py-6 lg:py-8">
        <div>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-foreground">
              Products ({products.length})
            </h2>
          </div>

          {products.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
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

                      <div className="p-5 flex flex-col flex-grow">
                        <h3 className="font-semibold text-base text-foreground mb-2 group-hover:text-accent-600 dark:group-hover:text-accent-400 transition-colors line-clamp-2 min-h-[3rem]">
                          {product.name}
                        </h3>
                        <div className="text-xs text-foreground-muted mb-3">
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
          ) : (
            <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-12 text-center">
              <svg className="mx-auto h-24 w-24 text-foreground-muted mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
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
      </div>
    </div>
  )
}
