import Link from 'next/link'
import Image from 'next/image'
import { queryMany } from '@/lib/db'
import CategoryIcon from '@/components/visitor/CategoryIcon'

export const dynamic = 'force-dynamic'

async function getFeaturedProducts() {
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
    WHERE p.is_featured = true AND p.is_active = true
    LIMIT 6
  `)
}

async function getMainCategories() {
  return queryMany(`
    SELECT * FROM categories
    WHERE parent_category_id IS NULL AND is_active = true
    ORDER BY display_order ASC
    LIMIT 6
  `)
}

export default async function HomePage() {
  const featuredProducts = await getFeaturedProducts()
  const mainCategories = await getMainCategories()

  return (
    <div className="bg-surface">

      {/* Hero */}
      <section className="bg-gradient-to-br from-primary-600 to-primary-800 text-white">
        <div className="container mx-auto px-4 py-10 md:py-20">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            <div>
              <p className="text-sm font-semibold uppercase tracking-widest text-primary-200 mb-2">Hardware &amp; Tools</p>
              <h1 className="text-3xl md:text-5xl font-bold mb-3 leading-tight">
                Jeffi Stores
              </h1>
              <p className="text-base text-primary-100 mb-6 leading-relaxed max-w-md">
                Your trusted source for industrial machinery parts, tools, and hardware — for manufacturing, construction, and repairs.
              </p>
              <div className="flex gap-3">
                <Link
                  href="/products"
                  className="bg-accent-500 hover:bg-accent-600 text-white px-6 py-2.5 rounded-lg font-semibold transition-colors text-sm"
                >
                  Shop Now
                </Link>
                <Link
                  href="/categories"
                  className="bg-white/15 hover:bg-white/25 text-white px-6 py-2.5 rounded-lg font-semibold transition-colors text-sm border border-white/30"
                >
                  Browse Categories
                </Link>
              </div>
            </div>
            <div className="hidden md:flex justify-center">
              <div className="relative h-80 w-full max-w-sm">
                <img
                  src="/images/Welcome.png"
                  alt="Hardware tools and industrial supplies"
                  className="w-full h-full object-contain drop-shadow-2xl"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Categories */}
      {mainCategories.length > 0 && (
        <section className="py-8 md:py-14 bg-surface">
          <div className="container mx-auto px-4">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl md:text-3xl font-bold text-foreground">Shop by Category</h2>
              <Link href="/categories" className="text-sm text-accent-500 hover:text-accent-600 font-semibold flex items-center gap-1">
                All
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>

            <div className="flex gap-3 overflow-x-auto pb-2 md:grid md:grid-cols-3 lg:grid-cols-6 md:overflow-visible scrollbar-hide">
              {mainCategories.map((category) => (
                <Link
                  key={category.id}
                  href={`/categories/${category.slug}`}
                  className="group flex-shrink-0 w-24 md:w-auto"
                >
                  <div className="flex flex-col items-center text-center gap-2 p-3 rounded-xl bg-surface-elevated border border-border-default hover:border-accent-400 hover:shadow-md transition-all">
                    <div className="w-12 h-12 bg-primary-50 dark:bg-primary-900/20 rounded-full flex items-center justify-center group-hover:bg-accent-50 dark:group-hover:bg-accent-900/20 transition-colors">
                      <CategoryIcon
                        categoryName={category.name}
                        className="w-6 h-6 text-primary-600 dark:text-primary-400 group-hover:text-accent-600"
                      />
                    </div>
                    <span className="text-xs font-medium text-foreground group-hover:text-accent-600 transition-colors leading-tight">
                      {category.name}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Featured Products */}
      {featuredProducts.length > 0 && (
        <section className="py-8 md:py-14 bg-surface-secondary">
          <div className="container mx-auto px-4">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl md:text-3xl font-bold text-foreground">Featured Products</h2>
              <Link href="/products" className="text-sm text-accent-500 hover:text-accent-600 font-semibold flex items-center gap-1">
                All
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-6">
              {featuredProducts.map((product) => {
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
                  <Link key={product.id} href={`/products/${product.slug}`} className="group">
                    <div className="bg-surface-elevated rounded-xl shadow-sm border border-border-default overflow-hidden hover:shadow-md transition-shadow h-full flex flex-col">
                      <div className="relative aspect-square bg-surface-elevated overflow-hidden">
                        {primaryImage ? (
                          <img
                            src={primaryImage.image_url}
                            alt={product.name}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <svg className="w-16 h-16 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          </div>
                        )}
                        {mrpDiscount > 0 && (
                          <div className="absolute top-2 right-2 bg-accent-500 text-white px-2 py-0.5 rounded-full text-xs font-bold">
                            {mrpDiscount}% off
                          </div>
                        )}
                      </div>
                      <div className="p-3 flex flex-col flex-1">
                        <h3 className="font-semibold text-sm text-foreground mb-1 group-hover:text-accent-600 transition-colors line-clamp-2 leading-snug flex-1">
                          {product.name}
                        </h3>
                        <div className="mt-2">
                          <span className="text-base font-bold text-primary-600 dark:text-primary-400">
                            {hasVariants ? 'From ' : ''}₹{Number(displayPrice).toLocaleString('en-IN')}
                          </span>
                          {mrp && mrp > Number(displayPrice) && (
                            <span className="text-xs text-foreground-muted line-through ml-1.5">
                              ₹{mrp.toLocaleString('en-IN')}
                            </span>
                          )}
                        </div>
                        <span className={`text-xs font-medium mt-1 ${effectiveStock > 0 ? 'text-green-600' : 'text-red-500'}`}>
                          {effectiveStock > 0 ? 'In Stock' : 'Out of Stock'}
                        </span>
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
            <div className="text-center mt-8">
              <Link
                href="/products"
                className="bg-accent-500 hover:bg-accent-600 text-white px-8 py-3 rounded-lg font-semibold transition-colors inline-block"
              >
                View All Products
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Features */}
      <section className="py-8 md:py-14 bg-surface">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-3 md:grid-cols-3 gap-3 md:gap-6">
            <div className="flex flex-col items-center text-center p-3 md:p-6 bg-surface-elevated rounded-xl border border-border-default shadow-sm">
              <div className="w-10 h-10 md:w-14 md:h-14 bg-primary-100 dark:bg-primary-900/20 rounded-full flex items-center justify-center mb-3">
                <svg className="w-5 h-5 md:w-7 md:h-7 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-xs md:text-base font-bold text-foreground mb-1">24/7 Service</h3>
              <p className="text-xs text-foreground-secondary hidden md:block">Round-the-clock support, always here when you need us.</p>
            </div>

            <div className="flex flex-col items-center text-center p-3 md:p-6 bg-surface-elevated rounded-xl border border-border-default shadow-sm">
              <div className="w-10 h-10 md:w-14 md:h-14 bg-primary-100 dark:bg-primary-900/20 rounded-full flex items-center justify-center mb-3">
                <svg className="w-5 h-5 md:w-7 md:h-7 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="text-xs md:text-base font-bold text-foreground mb-1">Fast Delivery</h3>
              <p className="text-xs text-foreground-secondary hidden md:block">Prompt dispatch and reliable delivery to your doorstep.</p>
            </div>

            <div className="flex flex-col items-center text-center p-3 md:p-6 bg-surface-elevated rounded-xl border border-border-default shadow-sm">
              <div className="w-10 h-10 md:w-14 md:h-14 bg-primary-100 dark:bg-primary-900/20 rounded-full flex items-center justify-center mb-3">
                <svg className="w-5 h-5 md:w-7 md:h-7 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
              </div>
              <h3 className="text-xs md:text-base font-bold text-foreground mb-1">Expert Support</h3>
              <p className="text-xs text-foreground-secondary hidden md:block">Reach out anytime for expert guidance and support.</p>
            </div>
          </div>
        </div>
      </section>

      {/* About */}
      <section className="py-8 md:py-14 bg-surface-secondary">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            <div>
              <h2 className="text-2xl md:text-4xl font-bold text-foreground mb-4">
                About Jeffi Stores
              </h2>
              <p className="text-foreground-secondary mb-4 leading-relaxed text-sm md:text-base">
                Jeffi Stores is your trusted hardware partner, offering a wide selection of industrial
                machinery parts — for manufacturing, construction, and repairs.
              </p>
              <p className="text-foreground-secondary mb-6 leading-relaxed text-sm md:text-base">
                Count on us for reliable products and expert service to keep your operations seamless.
              </p>
              <Link
                href="/about"
                className="text-accent-500 hover:text-accent-600 font-semibold inline-flex items-center text-sm"
              >
                Learn More About Us
                <svg className="w-4 h-4 ml-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
            <div className="hidden md:flex items-center justify-center h-72 bg-surface rounded-xl border border-border-default">
              <svg className="w-40 h-40 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
