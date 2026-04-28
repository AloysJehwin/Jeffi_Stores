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
      <section className="relative bg-gradient-to-br from-primary-600 via-primary-500 to-primary-700 overflow-hidden md:min-h-[calc(100vh-5rem)] md:flex md:items-center">
        <div className="container mx-auto px-4 sm:px-6 py-10 sm:py-14 md:py-16 relative z-10 w-full">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 lg:gap-20 items-center">

            {/* Text column */}
            <div className="order-2 md:order-1">
              <span className="inline-block bg-white/20 backdrop-blur-sm text-white font-bold uppercase tracking-widest rounded-full border border-white/30
                               text-[10px] sm:text-xs px-3 py-1.5 mb-4
                               md:text-sm md:px-4 md:py-2 md:mb-6">
                Hardware &amp; Industrial Tools
              </span>

              <h1 className="font-extrabold text-white leading-[1.05] tracking-tight mb-3 sm:mb-5 md:mb-6
                             text-[clamp(2.25rem,8vw,5rem)] md:text-[clamp(3rem,6vw,6rem)]">
                Jeffi <span className="text-secondary-500">Stores</span>
              </h1>

              <p className="text-white/80 leading-relaxed mb-6 sm:mb-8 max-w-md md:max-w-none
                            text-[clamp(0.875rem,2.5vw,1.25rem)] md:text-[clamp(1rem,2vw,1.5rem)]">
                Industrial machinery parts, tools, and hardware — for manufacturing, construction, and repairs.
              </p>

              <div className="flex gap-3 mb-6 sm:mb-10">
                <Link
                  href="/products"
                  className="bg-secondary-500 hover:bg-secondary-600 text-white font-bold rounded-xl shadow-lg transition-all
                             px-5 py-2.5 text-sm
                             sm:px-7 sm:py-3 sm:text-base
                             md:px-8 md:py-4 md:text-lg"
                >
                  Shop Now
                </Link>
                <Link
                  href="/categories"
                  className="bg-white/15 hover:bg-white/25 text-white font-semibold rounded-xl border border-white/40 transition-all
                             px-5 py-2.5 text-sm
                             sm:px-7 sm:py-3 sm:text-base
                             md:px-8 md:py-4 md:text-lg"
                >
                  Browse
                </Link>
              </div>

              <div className="flex items-center gap-5 sm:gap-8 pt-4 sm:pt-6 border-t border-white/20">
                {[
                  { val: '500+', label: 'Products' },
                  { val: '50+', label: 'Brands' },
                  { val: '24/7', label: 'Support' },
                ].map((stat, i, arr) => (
                  <div key={stat.label} className="flex items-center gap-5 sm:gap-8">
                    <div>
                      <p className="font-black text-white text-[clamp(1.5rem,4vw,2.5rem)] md:text-[clamp(2rem,3.5vw,2.75rem)] leading-none">{stat.val}</p>
                      <p className="text-white/60 font-medium mt-0.5 text-[clamp(0.65rem,1.5vw,0.875rem)]">{stat.label}</p>
                    </div>
                    {i < arr.length - 1 && <div className="w-px h-8 bg-white/20 shrink-0" />}
                  </div>
                ))}
              </div>
            </div>

            {/* Image column */}
            <div className="order-1 md:order-2 flex justify-center md:justify-end">
              <img
                src="/images/Welcome.png"
                alt="Industrial hardware and tools"
                className="w-[min(14rem,55vw)] sm:w-72 md:w-full md:max-w-xl lg:max-w-2xl object-contain drop-shadow-2xl"
                style={{ filter: 'drop-shadow(0 20px 40px rgba(0,0,0,0.2))' }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── Categories ── */}
      {mainCategories.length > 0 && (
        <section className="py-8 md:py-20 bg-surface">
          <div className="container mx-auto px-4">
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="text-accent-500 text-xs font-bold uppercase tracking-widest mb-0.5">Browse</p>
                <h2 className="text-2xl md:text-4xl font-extrabold text-foreground">Shop by Category</h2>
              </div>
              <Link href="/categories" className="text-sm text-accent-500 hover:text-accent-600 font-semibold flex items-center gap-1 shrink-0">
                View All
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>

            <div className="grid grid-cols-4 gap-2 sm:gap-3 md:grid-cols-4 lg:grid-cols-8">
              {mainCategories.map((category) => (
                <Link
                  key={category.id}
                  href={`/categories/${category.slug}`}
                  className="group"
                >
                  <div className="flex flex-col items-center text-center gap-2 p-3 rounded-xl bg-surface-elevated border border-border-default hover:border-primary-400 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                    <div className="w-11 h-11 sm:w-14 sm:h-14 bg-primary-50 dark:bg-primary-900/20 rounded-xl flex items-center justify-center group-hover:bg-primary-100 transition-colors">
                      <CategoryIcon
                        categoryName={category.name}
                        className="w-6 h-6 sm:w-7 sm:h-7 text-primary-600 dark:text-primary-400"
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

      {/* ── Featured Products ── */}
      {featuredProducts.length > 0 && (
        <section className="py-8 md:py-20 bg-surface-secondary">
          <div className="container mx-auto px-4">
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="text-accent-500 text-xs font-bold uppercase tracking-widest mb-0.5">Handpicked</p>
                <h2 className="text-2xl md:text-4xl font-extrabold text-foreground">Featured Products</h2>
              </div>
              <Link href="/products" className="text-sm text-accent-500 hover:text-accent-600 font-semibold flex items-center gap-1 shrink-0">
                View All
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
                    <div className="bg-surface-elevated rounded-xl shadow-sm border border-border-default overflow-hidden hover:shadow-lg transition-all duration-200 h-full flex flex-col">
                      <div className="relative aspect-[5/3] border-2 border-gray-300 dark:border-gray-600 overflow-hidden rounded-lg mx-2 mt-2 md:mx-3 md:mt-3">
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
                              className="relative w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                            />
                          </>
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-surface-secondary">
                            <svg className="w-10 h-10 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          </div>
                        )}
                        {mrpDiscount > 0 && (
                          <div className="absolute top-2 left-2 bg-accent-500 text-white px-1.5 py-0.5 rounded text-xs font-bold">
                            {mrpDiscount}% off
                          </div>
                        )}
                        {effectiveStock === 0 && (
                          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                            <span className="bg-white text-secondary-700 text-xs font-bold px-2 py-1 rounded-full">Out of Stock</span>
                          </div>
                        )}
                      </div>
                      <div className="p-2.5 md:p-4 flex flex-col flex-1">
                        {(product.categories?.name || product.brands?.name) && (
                          <p className="text-xs text-foreground-muted mb-0.5 truncate">{product.categories?.name || product.brands?.name}</p>
                        )}
                        <h3 className="font-semibold text-xs sm:text-sm text-foreground mb-1.5 group-hover:text-primary-600 transition-colors line-clamp-2 leading-snug flex-1">
                          {product.name}
                        </h3>
                        <div className="flex items-baseline gap-1.5 mt-auto flex-wrap">
                          <span className="text-sm sm:text-base font-extrabold text-primary-600 dark:text-primary-400">
                            {hasVariants ? 'From ' : ''}₹{Number(displayPrice).toLocaleString('en-IN')}
                          </span>
                          {mrp && mrp > Number(displayPrice) && (
                            <span className="text-xs text-foreground-muted line-through">
                              ₹{mrp.toLocaleString('en-IN')}
                            </span>
                          )}
                        </div>
                        <p className={`text-xs font-medium mt-1 ${effectiveStock > 0 ? 'text-green-600' : 'text-red-500'}`}>
                          {effectiveStock > 0 ? 'In Stock' : 'Out of Stock'}
                        </p>
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>

            <div className="text-center mt-7 md:mt-10">
              <Link
                href="/products"
                className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-8 py-3 md:px-10 md:py-4 rounded-xl font-bold transition-all shadow-lg text-sm md:text-base"
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
      <section className="py-8 md:py-20 bg-surface">
        <div className="container mx-auto px-4">
          <div className="text-center mb-6 md:mb-10">
            <p className="text-accent-500 text-xs font-bold uppercase tracking-widest mb-1">Why choose us</p>
            <h2 className="text-2xl md:text-4xl font-extrabold text-foreground">Built for Industry</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6">
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
              <div key={i} className="flex sm:flex-col items-start sm:items-start gap-4 bg-surface-elevated rounded-xl border border-border-default p-5 md:p-8">
                <div className="w-12 h-12 bg-primary-100 dark:bg-primary-900/30 rounded-xl flex items-center justify-center shrink-0">
                  <svg className="w-6 h-6 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    {item.icon}
                  </svg>
                </div>
                <div>
                  <h3 className="text-base md:text-lg font-bold text-foreground mb-1">{item.title}</h3>
                  <p className="text-sm text-foreground-secondary leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── About ── */}
      <section className="py-8 md:py-20 bg-surface-secondary">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-20 items-center">
            <div className="relative rounded-2xl overflow-hidden shadow-xl">
              <img
                src="/images/Working.png"
                alt="Jeffi Stores team"
                className="w-full h-52 sm:h-72 md:h-[420px] object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-secondary-900/50 via-transparent to-transparent" />
            </div>

            <div>
              <p className="text-accent-500 text-xs font-bold uppercase tracking-widest mb-2 mt-2 md:mt-0">About Us</p>
              <h2 className="text-2xl md:text-5xl font-extrabold text-foreground mb-4 leading-tight">
                Your Trusted<br />Hardware Partner
              </h2>
              <p className="text-sm md:text-lg text-foreground-secondary mb-3 leading-relaxed">
                Jeffi Stores is built for industry — offering machinery parts, fasteners, tools, and electrical components for manufacturing, construction, and industrial repairs.
              </p>
              <p className="text-sm md:text-lg text-foreground-secondary mb-6 leading-relaxed">
                We combine product breadth with expert service so your operations stay seamless and efficient.
              </p>

              <div className="grid grid-cols-2 gap-3 mb-6">
                <div className="bg-surface rounded-xl border border-border-default p-4">
                  <p className="text-2xl sm:text-3xl font-black text-primary-600">10+</p>
                  <p className="text-xs sm:text-sm text-foreground-secondary mt-0.5">Years in Business</p>
                </div>
                <div className="bg-surface rounded-xl border border-border-default p-4">
                  <p className="text-2xl sm:text-3xl font-black text-primary-600">1000+</p>
                  <p className="text-xs sm:text-sm text-foreground-secondary mt-0.5">Happy Customers</p>
                </div>
              </div>

              <Link
                href="/about"
                className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-6 py-3 rounded-xl font-bold transition-all text-sm md:text-base shadow-lg"
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

    </div>
  )
}
