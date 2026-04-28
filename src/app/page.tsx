import Link from 'next/link'
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
    LIMIT 8
  `)
}

export default async function HomePage() {
  const featuredProducts = await getFeaturedProducts()
  const mainCategories = await getMainCategories()

  return (
    <div className="bg-surface">

      {/* Hero */}
      <section className="relative overflow-hidden bg-secondary-500 text-white min-h-[520px] flex items-center">
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
          }}
        />
        <div className="absolute right-0 top-0 w-1/2 h-full bg-gradient-to-l from-primary-600/20 to-transparent pointer-events-none" />

        <div className="container mx-auto px-4 py-16 md:py-24 relative z-10">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
            <div>
              <div className="inline-flex items-center gap-2 bg-primary-500/20 border border-primary-400/30 rounded-full px-4 py-1.5 mb-6">
                <span className="w-2 h-2 rounded-full bg-primary-400 animate-pulse" />
                <span className="text-primary-300 text-sm font-semibold tracking-wide uppercase">Industrial Hardware &amp; Tools</span>
              </div>
              <h1 className="text-4xl md:text-6xl font-bold mb-4 leading-tight">
                Built for
                <span className="block text-primary-400">Industry.</span>
              </h1>
              <p className="text-base md:text-lg text-gray-300 mb-8 leading-relaxed max-w-md">
                Machinery parts, tools, fasteners, and more — sourced for manufacturing, construction, and industrial repairs.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link
                  href="/products"
                  className="bg-primary-500 hover:bg-primary-600 text-secondary-900 px-7 py-3 rounded-lg font-bold transition-colors text-sm shadow-lg shadow-primary-500/30"
                >
                  Shop Now
                </Link>
                <Link
                  href="/categories"
                  className="bg-white/10 hover:bg-white/20 text-white px-7 py-3 rounded-lg font-semibold transition-colors text-sm border border-white/20"
                >
                  Browse Categories
                </Link>
              </div>

              <div className="flex gap-8 mt-10 pt-8 border-t border-white/10">
                <div>
                  <p className="text-2xl font-bold text-primary-400">500+</p>
                  <p className="text-xs text-gray-400 mt-0.5">Products</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-primary-400">50+</p>
                  <p className="text-xs text-gray-400 mt-0.5">Brands</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-primary-400">24/7</p>
                  <p className="text-xs text-gray-400 mt-0.5">Support</p>
                </div>
              </div>
            </div>

            <div className="hidden md:flex justify-end items-center relative">
              <div className="w-full max-w-md aspect-[4/3] relative">
                <div className="absolute inset-0 bg-gradient-to-br from-primary-500/10 to-transparent rounded-2xl" />
                <img
                  src="/images/Welcome.png"
                  alt="Industrial hardware tools"
                  className="w-full h-full object-contain drop-shadow-2xl"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust bar */}
      <div className="bg-primary-500">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-3 divide-x divide-primary-600">
            <div className="flex items-center justify-center gap-2.5 py-3 px-4">
              <svg className="w-5 h-5 text-secondary-700 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span className="text-secondary-800 font-semibold text-xs sm:text-sm">Fast Delivery</span>
            </div>
            <div className="flex items-center justify-center gap-2.5 py-3 px-4">
              <svg className="w-5 h-5 text-secondary-700 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <span className="text-secondary-800 font-semibold text-xs sm:text-sm">Genuine Products</span>
            </div>
            <div className="flex items-center justify-center gap-2.5 py-3 px-4">
              <svg className="w-5 h-5 text-secondary-700 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              <span className="text-secondary-800 font-semibold text-xs sm:text-sm">Expert Support</span>
            </div>
          </div>
        </div>
      </div>

      {/* Categories */}
      {mainCategories.length > 0 && (
        <section className="py-10 md:py-16 bg-surface">
          <div className="container mx-auto px-4">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl md:text-3xl font-bold text-foreground">Shop by Category</h2>
                <p className="text-foreground-secondary text-sm mt-1">Find what you need across our product range</p>
              </div>
              <Link href="/categories" className="text-sm text-accent-500 hover:text-accent-600 font-semibold flex items-center gap-1 shrink-0">
                View All
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>

            <div className="flex gap-3 overflow-x-auto pb-2 md:grid md:grid-cols-4 lg:grid-cols-8 md:overflow-visible scrollbar-hide">
              {mainCategories.map((category) => (
                <Link
                  key={category.id}
                  href={`/categories/${category.slug}`}
                  className="group flex-shrink-0 w-28 md:w-auto"
                >
                  <div className="flex flex-col items-center text-center gap-3 p-4 rounded-xl bg-surface-elevated border border-border-default hover:border-primary-400 hover:shadow-md transition-all">
                    <div className="w-14 h-14 bg-primary-50 dark:bg-primary-900/20 rounded-xl flex items-center justify-center group-hover:bg-primary-100 dark:group-hover:bg-primary-900/40 transition-colors">
                      <CategoryIcon
                        categoryName={category.name}
                        className="w-7 h-7 text-primary-600 dark:text-primary-400"
                      />
                    </div>
                    <span className="text-xs font-semibold text-foreground group-hover:text-primary-600 transition-colors leading-tight">
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
        <section className="py-10 md:py-16 bg-surface-secondary">
          <div className="container mx-auto px-4">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl md:text-3xl font-bold text-foreground">Featured Products</h2>
                <p className="text-foreground-secondary text-sm mt-1">Top picks for your industrial needs</p>
              </div>
              <Link href="/products" className="text-sm text-accent-500 hover:text-accent-600 font-semibold flex items-center gap-1 shrink-0">
                View All
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-5">
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
                    <div className="bg-surface-elevated rounded-xl shadow-sm border border-border-default overflow-hidden hover:shadow-lg hover:border-primary-300 transition-all h-full flex flex-col">
                      <div className="relative aspect-square bg-surface overflow-hidden">
                        {primaryImage ? (
                          <img
                            src={primaryImage.image_url}
                            alt={product.name}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-surface-secondary">
                            <svg className="w-14 h-14 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          </div>
                        )}
                        {mrpDiscount > 0 && (
                          <div className="absolute top-2 left-2 bg-accent-500 text-white px-2 py-0.5 rounded-md text-xs font-bold">
                            {mrpDiscount}% off
                          </div>
                        )}
                        {effectiveStock === 0 && (
                          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                            <span className="bg-white text-secondary-700 text-xs font-bold px-3 py-1 rounded-full">Out of Stock</span>
                          </div>
                        )}
                      </div>
                      <div className="p-3 md:p-4 flex flex-col flex-1">
                        <p className="text-xs text-foreground-muted mb-1">{product.categories?.name || product.brands?.name || ''}</p>
                        <h3 className="font-semibold text-sm text-foreground mb-2 group-hover:text-primary-600 transition-colors line-clamp-2 leading-snug flex-1">
                          {product.name}
                        </h3>
                        <div className="flex items-end gap-2 mt-auto">
                          <span className="text-base font-bold text-secondary-500 dark:text-primary-400">
                            {hasVariants ? 'From ' : ''}₹{Number(displayPrice).toLocaleString('en-IN')}
                          </span>
                          {mrp && mrp > Number(displayPrice) && (
                            <span className="text-xs text-foreground-muted line-through pb-0.5">
                              ₹{mrp.toLocaleString('en-IN')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
            <div className="text-center mt-10">
              <Link
                href="/products"
                className="inline-flex items-center gap-2 bg-secondary-500 hover:bg-secondary-600 text-white px-8 py-3 rounded-lg font-semibold transition-colors shadow-sm"
              >
                View All Products
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* About */}
      <section className="py-10 md:py-20 bg-surface">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-16 items-center">
            <div className="order-2 md:order-1 relative rounded-2xl overflow-hidden shadow-xl">
              <img
                src="/images/Working.png"
                alt="Jeffi Stores team at work"
                className="w-full h-72 md:h-96 object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-secondary-900/40 to-transparent" />
              <div className="absolute bottom-4 left-4 right-4">
                <div className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl p-4 flex items-center gap-4">
                  <div className="w-10 h-10 bg-primary-500 rounded-full flex items-center justify-center shrink-0">
                    <svg className="w-5 h-5 text-secondary-800" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-white font-semibold text-sm">Serving across India</p>
                    <p className="text-white/70 text-xs">Manufacturing, Construction &amp; Repairs</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="order-1 md:order-2">
              <p className="text-accent-500 font-semibold text-sm uppercase tracking-widest mb-3">About Us</p>
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-5 leading-tight">
                Your Trusted<br />Hardware Partner
              </h2>
              <p className="text-foreground-secondary mb-4 leading-relaxed text-sm md:text-base">
                Jeffi Stores is built for industry — offering a wide selection of machinery parts, fasteners, tools, and electrical components for manufacturing, construction, and repairs.
              </p>
              <p className="text-foreground-secondary mb-8 leading-relaxed text-sm md:text-base">
                We combine product breadth with expert service, ensuring your operations stay seamless and efficient.
              </p>

              <div className="grid grid-cols-2 gap-4 mb-8">
                <div className="bg-surface-elevated border border-border-default rounded-xl p-4">
                  <p className="text-2xl font-bold text-primary-600">10+</p>
                  <p className="text-xs text-foreground-secondary mt-0.5">Years in Business</p>
                </div>
                <div className="bg-surface-elevated border border-border-default rounded-xl p-4">
                  <p className="text-2xl font-bold text-primary-600">1000+</p>
                  <p className="text-xs text-foreground-secondary mt-0.5">Happy Customers</p>
                </div>
              </div>

              <Link
                href="/about"
                className="inline-flex items-center gap-2 bg-secondary-500 hover:bg-secondary-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors text-sm"
              >
                Learn More About Us
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-12 md:py-16 bg-secondary-500 text-white">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-2xl md:text-4xl font-bold mb-3">Ready to stock up?</h2>
          <p className="text-gray-300 mb-8 max-w-xl mx-auto text-sm md:text-base">
            Browse our full catalogue of industrial hardware, tools, and components — fast delivery across India.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/products"
              className="bg-primary-500 hover:bg-primary-600 text-secondary-900 px-8 py-3 rounded-lg font-bold transition-colors shadow-lg shadow-primary-500/20"
            >
              Browse Products
            </Link>
            <Link
              href="/contact"
              className="bg-white/10 hover:bg-white/20 text-white px-8 py-3 rounded-lg font-semibold transition-colors border border-white/20"
            >
              Contact Us
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
