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

      {/* ── Hero ── */}
      <section className="relative bg-gradient-to-br from-primary-600 via-primary-500 to-primary-700 overflow-hidden min-h-[88vh] flex items-center">
        <div className="absolute inset-0 bg-[url('/images/Welcome.png')] bg-right-bottom bg-no-repeat bg-contain opacity-20 md:opacity-0 pointer-events-none" />

        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24 relative z-10 w-full">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">

            <div className="max-w-xl">
              <span className="inline-block bg-white/20 backdrop-blur-sm text-white text-xs sm:text-sm font-bold uppercase tracking-widest px-4 py-2 rounded-full mb-5 border border-white/30">
                Hardware &amp; Industrial Tools
              </span>

              <h1 className="text-5xl sm:text-6xl md:text-7xl font-extrabold text-white leading-[1.05] mb-5 tracking-tight">
                Jeffi
                <br />
                <span className="text-secondary-500">Stores</span>
              </h1>

              <p className="text-lg sm:text-xl md:text-2xl text-white/80 mb-8 leading-relaxed">
                Your trusted source for industrial machinery parts, tools, and hardware —
                for manufacturing, construction, and repairs.
              </p>

              <div className="flex flex-wrap gap-3 mb-10">
                <Link
                  href="/products"
                  className="bg-secondary-500 hover:bg-secondary-600 text-white px-8 py-4 rounded-xl font-bold transition-all text-base shadow-xl shadow-secondary-900/30 hover:scale-[1.02]"
                >
                  Shop Now
                </Link>
                <Link
                  href="/categories"
                  className="bg-white/15 hover:bg-white/25 text-white px-8 py-4 rounded-xl font-semibold transition-all text-base border border-white/40 backdrop-blur-sm hover:scale-[1.02]"
                >
                  Browse Categories
                </Link>
              </div>

              <div className="flex items-center gap-8 pt-8 border-t border-white/20">
                <div>
                  <p className="text-3xl sm:text-4xl font-black text-white">500+</p>
                  <p className="text-white/60 text-sm mt-1 font-medium">Products</p>
                </div>
                <div className="w-px h-10 bg-white/20" />
                <div>
                  <p className="text-3xl sm:text-4xl font-black text-white">50+</p>
                  <p className="text-white/60 text-sm mt-1 font-medium">Brands</p>
                </div>
                <div className="w-px h-10 bg-white/20" />
                <div>
                  <p className="text-3xl sm:text-4xl font-black text-white">24/7</p>
                  <p className="text-white/60 text-sm mt-1 font-medium">Support</p>
                </div>
              </div>
            </div>

            <div className="hidden md:flex items-center justify-center relative">
              <div className="absolute w-[420px] h-[420px] rounded-full bg-white/10 blur-3xl -z-10" />
              <img
                src="/images/Welcome.png"
                alt="Industrial hardware and tools"
                className="w-full max-w-lg object-contain drop-shadow-2xl"
                style={{ filter: 'drop-shadow(0 30px 60px rgba(0,0,0,0.25))' }}
              />
            </div>
          </div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-surface to-transparent pointer-events-none" />
      </section>

      {/* ── Trust bar ── */}
      <div className="bg-secondary-500 text-white">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-3 divide-x divide-white/10">
            {[
              {
                icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />,
                title: 'Fast Delivery',
                sub: 'Reliable dispatch, pan India',
              },
              {
                icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />,
                title: 'Genuine Products',
                sub: 'Sourced from top manufacturers',
              },
              {
                icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />,
                title: '24/7 Expert Support',
                sub: 'Always here when you need us',
              },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-3 py-4 px-4 sm:px-8">
                <svg className="w-6 h-6 text-primary-400 shrink-0 hidden sm:block" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  {item.icon}
                </svg>
                <div>
                  <p className="font-bold text-sm sm:text-base">{item.title}</p>
                  <p className="text-white/50 text-xs sm:text-sm hidden sm:block">{item.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Categories ── */}
      {mainCategories.length > 0 && (
        <section className="py-12 md:py-20 bg-surface">
          <div className="container mx-auto px-4">
            <div className="flex items-end justify-between mb-8">
              <div>
                <p className="text-accent-500 text-sm font-bold uppercase tracking-widest mb-1">Browse</p>
                <h2 className="text-3xl md:text-4xl font-extrabold text-foreground">Shop by Category</h2>
              </div>
              <Link href="/categories" className="text-base text-accent-500 hover:text-accent-600 font-semibold flex items-center gap-1 shrink-0 mb-1">
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
                  className="group flex-shrink-0 w-32 md:w-auto"
                >
                  <div className="flex flex-col items-center text-center gap-3 p-4 rounded-2xl bg-surface-elevated border border-border-default hover:border-primary-400 hover:shadow-lg hover:-translate-y-1 transition-all duration-200">
                    <div className="w-14 h-14 bg-primary-50 dark:bg-primary-900/20 rounded-2xl flex items-center justify-center group-hover:bg-primary-100 dark:group-hover:bg-primary-900/40 transition-colors">
                      <CategoryIcon
                        categoryName={category.name}
                        className="w-7 h-7 text-primary-600 dark:text-primary-400"
                      />
                    </div>
                    <span className="text-sm font-semibold text-foreground group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors leading-tight">
                      {category.name}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Featured Products ── */}
      {featuredProducts.length > 0 && (
        <section className="py-12 md:py-20 bg-surface-secondary">
          <div className="container mx-auto px-4">
            <div className="flex items-end justify-between mb-8">
              <div>
                <p className="text-accent-500 text-sm font-bold uppercase tracking-widest mb-1">Handpicked</p>
                <h2 className="text-3xl md:text-4xl font-extrabold text-foreground">Featured Products</h2>
              </div>
              <Link href="/products" className="text-base text-accent-500 hover:text-accent-600 font-semibold flex items-center gap-1 shrink-0 mb-1">
                View All
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6">
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
                    <div className="bg-surface-elevated rounded-2xl shadow-sm border border-border-default overflow-hidden hover:shadow-xl hover:-translate-y-1 transition-all duration-200 h-full flex flex-col">
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
                          <div className="absolute top-2 left-2 bg-accent-500 text-white px-2 py-1 rounded-lg text-xs font-bold shadow-sm">
                            {mrpDiscount}% off
                          </div>
                        )}
                        {effectiveStock === 0 && (
                          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                            <span className="bg-white text-secondary-700 text-xs font-bold px-3 py-1.5 rounded-full">Out of Stock</span>
                          </div>
                        )}
                      </div>
                      <div className="p-3 md:p-4 flex flex-col flex-1">
                        {(product.categories?.name || product.brands?.name) && (
                          <p className="text-xs sm:text-sm text-foreground-muted mb-1">{product.categories?.name || product.brands?.name}</p>
                        )}
                        <h3 className="font-semibold text-sm sm:text-base text-foreground mb-2 group-hover:text-primary-600 transition-colors line-clamp-2 leading-snug flex-1">
                          {product.name}
                        </h3>
                        <div className="flex items-baseline gap-2 mt-auto">
                          <span className="text-base sm:text-lg font-extrabold text-primary-600 dark:text-primary-400">
                            {hasVariants ? 'From ' : ''}₹{Number(displayPrice).toLocaleString('en-IN')}
                          </span>
                          {mrp && mrp > Number(displayPrice) && (
                            <span className="text-xs sm:text-sm text-foreground-muted line-through">
                              ₹{mrp.toLocaleString('en-IN')}
                            </span>
                          )}
                        </div>
                        <p className={`text-xs sm:text-sm font-medium mt-1 ${effectiveStock > 0 ? 'text-green-600' : 'text-red-500'}`}>
                          {effectiveStock > 0 ? 'In Stock' : 'Out of Stock'}
                        </p>
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>

            <div className="text-center mt-10">
              <Link
                href="/products"
                className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-10 py-4 rounded-xl font-bold transition-all shadow-lg shadow-primary-500/30 hover:scale-[1.02] text-base"
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

      {/* ── Why Jeffi Stores ── */}
      <section className="py-12 md:py-20 bg-surface">
        <div className="container mx-auto px-4">
          <div className="text-center mb-10">
            <p className="text-accent-500 text-sm font-bold uppercase tracking-widest mb-1">Why choose us</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-foreground">Built for Industry</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />,
                title: 'Fast Delivery',
                desc: 'Prompt dispatch and reliable delivery to your doorstep across India.',
              },
              {
                icon: <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></>,
                title: 'Wide Product Range',
                desc: 'Fasteners, power tools, electrical, welding, and hundreds of industrial categories.',
              },
              {
                icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />,
                title: '24/7 Support',
                desc: 'Our expert team is always available to help you source the right product.',
              },
            ].map((item, i) => (
              <div key={i} className="relative group bg-surface-elevated rounded-2xl border border-border-default p-8 hover:border-primary-300 hover:shadow-lg transition-all duration-200 overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 bg-primary-50 dark:bg-primary-900/10 rounded-bl-[3rem] -z-0 group-hover:bg-primary-100 dark:group-hover:bg-primary-900/20 transition-colors" />
                <div className="relative z-10">
                  <div className="w-14 h-14 bg-primary-100 dark:bg-primary-900/30 rounded-2xl flex items-center justify-center mb-5">
                    <svg className="w-7 h-7 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      {item.icon}
                    </svg>
                  </div>
                  <h3 className="text-xl font-bold text-foreground mb-2">{item.title}</h3>
                  <p className="text-base text-foreground-secondary leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── About ── */}
      <section className="py-12 md:py-20 bg-surface-secondary">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-20 items-center">
            <div className="relative rounded-3xl overflow-hidden shadow-2xl">
              <img
                src="/images/Working.png"
                alt="Jeffi Stores team"
                className="w-full h-72 md:h-[420px] object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-secondary-900/50 via-transparent to-transparent" />
              <div className="absolute bottom-5 left-5 right-5">
                <div className="bg-white dark:bg-secondary-800 rounded-2xl px-5 py-4 shadow-xl flex items-center gap-4">
                  <div className="w-12 h-12 bg-primary-500 rounded-xl flex items-center justify-center shrink-0">
                    <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-bold text-foreground text-base">Serving across India</p>
                    <p className="text-foreground-secondary text-sm">Manufacturing · Construction · Repairs</p>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <p className="text-accent-500 text-sm font-bold uppercase tracking-widest mb-3">About Us</p>
              <h2 className="text-3xl md:text-5xl font-extrabold text-foreground mb-5 leading-tight">
                Your Trusted<br />Hardware Partner
              </h2>
              <p className="text-base md:text-lg text-foreground-secondary mb-4 leading-relaxed">
                Jeffi Stores is built for industry — offering machinery parts, fasteners, tools, and electrical components for manufacturing, construction, and industrial repairs.
              </p>
              <p className="text-base md:text-lg text-foreground-secondary mb-8 leading-relaxed">
                We combine product breadth with expert service so your operations stay seamless and efficient.
              </p>

              <div className="grid grid-cols-2 gap-4 mb-8">
                <div className="bg-surface rounded-2xl border border-border-default p-5">
                  <p className="text-3xl sm:text-4xl font-black text-primary-600">10+</p>
                  <p className="text-sm text-foreground-secondary mt-1">Years in Business</p>
                </div>
                <div className="bg-surface rounded-2xl border border-border-default p-5">
                  <p className="text-3xl sm:text-4xl font-black text-primary-600">1000+</p>
                  <p className="text-sm text-foreground-secondary mt-1">Happy Customers</p>
                </div>
              </div>

              <Link
                href="/about"
                className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-7 py-4 rounded-xl font-bold transition-all text-base shadow-lg shadow-primary-500/25 hover:scale-[1.02]"
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

      {/* ── CTA ── */}
      <section className="relative py-16 md:py-24 overflow-hidden bg-gradient-to-br from-primary-600 to-primary-700">
        <div className="absolute inset-0 opacity-5" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23000' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/svg%3E")` }} />
        <div className="container mx-auto px-4 text-center relative z-10">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-white mb-4 leading-tight">
            Ready to stock up?
          </h2>
          <p className="text-white/75 mb-10 max-w-lg mx-auto text-base md:text-lg leading-relaxed">
            Browse our full catalogue of industrial hardware, tools, and components — fast delivery across India.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/products"
              className="bg-secondary-500 hover:bg-secondary-600 text-white px-10 py-4 rounded-xl font-bold transition-all shadow-xl hover:scale-[1.02] text-base"
            >
              Browse Products
            </Link>
            <Link
              href="/contact"
              className="bg-white/15 hover:bg-white/25 text-white px-10 py-4 rounded-xl font-bold transition-all border border-white/30 backdrop-blur-sm hover:scale-[1.02] text-base"
            >
              Contact Us
            </Link>
          </div>
        </div>
      </section>

    </div>
  )
}
