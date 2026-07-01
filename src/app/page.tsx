import Link from 'next/link'
import { queryMany } from '@/lib/db'
import { VARIANT_MIN_PRICE_INCL_GST_SQL, VARIANT_MIN_MRP_SQL, VARIANT_STOCK_TOTAL_SQL } from '@/lib/queries'
import CategoryIcon from '@/components/visitor/CategoryIcon'
import ReviewCouponPopup from '@/components/visitor/ReviewCouponPopup'
import ProductCard from '@/components/visitor/ProductCard'
import HeroCarousel from '@/components/visitor/HeroCarousel'
import { getHost } from '@/lib/get-host'

export const revalidate = 120

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
      ${VARIANT_STOCK_TOTAL_SQL} AS variant_stock_total,
      ${VARIANT_MIN_PRICE_INCL_GST_SQL} AS variant_min_price,
      ${VARIANT_MIN_MRP_SQL} AS variant_min_mrp
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE p.is_featured = true AND p.is_active = true
    LIMIT 8
  `)
}

async function getNewArrivals() {
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
      ${VARIANT_MIN_PRICE_INCL_GST_SQL} AS variant_min_price,
      ${VARIANT_MIN_MRP_SQL} AS variant_min_mrp
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE p.is_active = true
    ORDER BY p.created_at DESC
    LIMIT 4
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

async function getHeroSlides() {
  // Pick 4 categories daily using a date-seeded deterministic shuffle.
  // Prioritise categories with hero images; fall back to any active parent category.
  const all = await queryMany<{
    name: string; slug: string;
    hero_image_mobile: string | null; hero_image_desktop: string | null;
  }>(`
    SELECT name, slug, hero_image_mobile, hero_image_desktop
    FROM categories
    WHERE parent_category_id IS NULL AND is_active = true
    ORDER BY display_order ASC
  `)

  // Date seed: days since epoch — changes once per day
  const daySeed = Math.floor(Date.now() / 86_400_000)

  // Fisher-Yates with seeded PRNG (mulberry32)
  function mulberry32(seed: number) {
    return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
  }
  const rng = mulberry32(daySeed)
  const shuffled = [...all]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }

  return shuffled.slice(0, 4)
}

function productCardProps(product: any) {
  const primaryImage = product.product_images?.find((img: any) => img.is_primary) || product.product_images?.[0]
  const hasVariants = product.has_variants
  const displayPrice = hasVariants && product.variant_min_price
    ? Number(product.variant_min_price)
    : Number(product.base_price)
  const effectiveStock = hasVariants ? Number(product.variant_stock_total) : (product.stock_status !== 'Out of Stock' ? 1 : 0)
  const mrp = product.mrp ? Number(product.mrp) : (product.variant_min_mrp ? Number(product.variant_min_mrp) : null)
  const mrpDiscount = mrp && mrp > displayPrice ? Math.round(((mrp - displayPrice) / mrp) * 100) : 0
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    hasVariants,
    displayPrice,
    mrp,
    mrpDiscount,
    effectiveStock,
    primaryImage: primaryImage || null,
    brandName: product.brands?.name || null,
    categoryName: product.categories?.name || null,
    discountPct: Number(product.discount_pct ?? 0),
    extraDeliveryDays: Number(product.extra_delivery_days ?? 0) }
}

export default async function HomePage() {
  const [featuredProducts, newArrivals, mainCategories, heroSlides] = await Promise.all([
    getFeaturedProducts(),
    getNewArrivals(),
    getMainCategories(),
    getHeroSlides(),
  ])

  const host = await getHost()
  const isLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|$)/.test(host) || /\.local(:|$)/.test(host)
  const businessOrigin = isLocal ? '' : 'https://business.jeffistores.in'
  const businessLandingUrl = isLocal ? '/business' : `${businessOrigin}/`
  const businessSignupUrl = isLocal ? '/business/signup' : `${businessOrigin}/signup`

  return (
    <div className="bg-surface">

      {/* ── Hero Carousel ── */}
      <HeroCarousel slides={heroSlides} />

      {/* ── Shop by Category ── */}
      {mainCategories.length > 0 && (
        <section className="pt-8 pb-12 md:py-20 bg-surface">
          <div className="container mx-auto px-4">
            <div className="flex items-end justify-between mb-7">
              <div>
                <p className="text-primary-500 text-[10px] font-black uppercase tracking-[0.2em] mb-1.5">Explore</p>
                <h2 className="text-2xl md:text-4xl font-black text-foreground tracking-tight">Shop by Category</h2>
              </div>
              <Link href="/categories" className="hidden sm:flex items-center gap-1 text-sm text-accent-500 hover:text-accent-400 font-semibold shrink-0 transition-colors">
                View All
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 lg:grid-cols-8">
              {mainCategories.map((category) => (
                <Link key={category.id} href={`/categories/${category.slug}`} className="group">
                  <div className="flex flex-col items-center text-center gap-2.5 p-4 rounded-2xl bg-surface-elevated border border-border-default
                                  hover:border-primary-400/60 hover:bg-primary-50 dark:hover:bg-primary-900/10 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200">
                    <div className="w-12 h-12 bg-primary-100 dark:bg-primary-900/25 rounded-xl flex items-center justify-center group-hover:bg-primary-200 dark:group-hover:bg-primary-800/40 transition-colors shrink-0">
                      <CategoryIcon categoryName={category.name} className="w-6 h-6 text-primary-600 dark:text-primary-400" />
                    </div>
                    <span className="text-xs font-bold text-foreground group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors leading-tight line-clamp-2 flex items-center justify-center min-h-[2.25rem]">
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
            {/* Title card */}
            <div className="flex items-end justify-between mb-7">
              <div className="flex items-center gap-4">
                <div className="w-1 h-10 bg-primary-500 rounded-full" />
                <div>
                  <p className="text-primary-500 text-[10px] font-black uppercase tracking-[0.2em] mb-1">Handpicked</p>
                  <h2 className="text-2xl md:text-4xl font-black text-foreground tracking-tight">Featured Products</h2>
                </div>
              </div>
              <Link href="/products" className="hidden sm:flex items-center gap-1 text-sm text-accent-500 hover:text-accent-400 font-semibold shrink-0 transition-colors">
                View All
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5">
              {featuredProducts.map((product) => (
                <ProductCard key={product.id} {...productCardProps(product)} />
              ))}
            </div>

            <div className="text-center mt-8">
              <Link
                href="/products"
                className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-8 py-3 rounded-xl font-bold transition-all shadow-lg shadow-primary-500/20 text-sm md:text-base"
              >
                View All Products
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* ── New Arrivals ── */}
      {newArrivals.length > 0 && (
        <section className="py-12 md:py-20 bg-surface">
          <div className="container mx-auto px-4">
            <div className="flex items-end justify-between mb-7">
              <div className="flex items-center gap-4">
                <div className="w-1 h-10 bg-accent-500 rounded-full" />
                <div>
                  <p className="text-accent-500 text-[10px] font-black uppercase tracking-[0.2em] mb-1">Just in</p>
                  <h2 className="text-2xl md:text-4xl font-black text-foreground tracking-tight">New Arrivals</h2>
                </div>
              </div>
              <Link href="/products?sort=newest" className="hidden sm:flex items-center gap-1 text-sm text-accent-500 hover:text-accent-400 font-semibold shrink-0 transition-colors">
                See All
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5">
              {newArrivals.map((product) => (
                <ProductCard key={product.id} {...productCardProps(product)} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Why Jeffi Stores ── */}
      <section className="py-12 md:py-20 bg-surface-secondary">
        <div className="container mx-auto px-4">
          <div className="text-center mb-10">
            <p className="text-primary-500 text-[10px] font-black uppercase tracking-[0.2em] mb-2">Why us</p>
            <h2 className="text-2xl md:text-4xl font-black text-foreground tracking-tight">Built for Industry</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6">
            {[
              {
                d: 'M13 10V3L4 14h7v7l9-11h-7z',
                title: 'Fast Delivery',
                desc: 'Prompt dispatch and reliable delivery to your doorstep across India.',
                color: 'primary' },
              {
                d: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
                title: 'Wide Range',
                desc: 'Fasteners, power tools, electrical, welding, and hundreds of industrial categories.',
                color: 'accent' },
              {
                d: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
                title: '24/7 Support',
                desc: 'Expert team always available to help you source the right product fast.',
                color: 'secondary' },
            ].map((item) => (
              <div key={item.title} className="relative bg-surface-elevated rounded-2xl border border-border-default p-6 md:p-8 overflow-hidden group hover:border-primary-400/50 hover:shadow-lg transition-all">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-5
                  ${item.color === 'primary' ? 'bg-primary-100 dark:bg-primary-900/30' : item.color === 'accent' ? 'bg-accent-100 dark:bg-accent-900/30' : 'bg-secondary-100 dark:bg-secondary-800/50'}`}>
                  <svg className={`w-6 h-6 ${item.color === 'primary' ? 'text-primary-600 dark:text-primary-400' : item.color === 'accent' ? 'text-accent-600 dark:text-accent-400' : 'text-secondary-600 dark:text-secondary-400'}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={item.d} />
                  </svg>
                </div>
                <h3 className="text-lg font-black text-foreground mb-2">{item.title}</h3>
                <p className="text-sm text-foreground-secondary leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── About ── */}
      <section className="py-12 md:py-20 bg-surface">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-20 items-center">
            <div className="relative rounded-2xl overflow-hidden shadow-2xl">
              <img
                src="/images/Working.png"
                alt="Jeffi Stores team"
                className="w-full h-56 sm:h-80 md:h-[440px] object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-secondary-900/60 via-transparent to-transparent" />
              <div className="absolute bottom-4 left-4 right-4 flex gap-3">
                <div className="bg-white/10 backdrop-blur-md rounded-xl px-4 py-3 border border-white/15 flex-1">
                  <p className="text-white font-black text-2xl">10+</p>
                  <p className="text-white/60 text-xs font-semibold mt-0.5">Years in Business</p>
                </div>
                <div className="bg-white/10 backdrop-blur-md rounded-xl px-4 py-3 border border-white/15 flex-1">
                  <p className="text-white font-black text-2xl">1000+</p>
                  <p className="text-white/60 text-xs font-semibold mt-0.5">Happy Customers</p>
                </div>
              </div>
            </div>

            <div className="space-y-5">
              <div>
                <p className="text-primary-500 text-[10px] font-black uppercase tracking-[0.2em] mb-2">About Us</p>
                <h2 className="text-2xl md:text-5xl font-black text-foreground leading-tight">
                  Your Trusted<br />Hardware Partner
                </h2>
              </div>
              <p className="text-sm md:text-base text-foreground-secondary leading-relaxed">
                Jeffi Stores is built for industry — offering machinery parts, fasteners, tools, and electrical components for manufacturing, construction, and industrial repairs.
              </p>
              <p className="text-sm md:text-base text-foreground-secondary leading-relaxed">
                We combine product breadth with expert service so your operations stay seamless and efficient.
              </p>

              <div className="flex flex-wrap gap-3 pt-2">
                <Link
                  href="/about"
                  className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-6 py-3 rounded-xl font-bold transition-all text-sm shadow-lg shadow-primary-500/20"
                >
                  Learn More
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
                <Link
                  href="/products"
                  className="inline-flex items-center gap-2 border border-border-default hover:border-primary-400 text-foreground px-6 py-3 rounded-xl font-bold transition-all text-sm"
                >
                  Browse Products
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Business CTA ── */}
      <div className="px-3 sm:px-6 md:px-8 py-3 md:py-6 bg-surface">
        <div className="relative rounded-2xl overflow-hidden shadow-2xl min-h-[340px] md:min-h-[400px]" style={{ background: '#0d0d0d' }}>
          {/* Background image — right portion only, matching HeroCarousel */}
          <div className="absolute inset-0">
            <img
              src="/images/business-hero.webp"
              alt=""
              className="absolute right-0 top-0 h-full w-[70%] sm:w-[65%] object-cover object-center"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-[#0d0d0d] from-35% via-[#0d0d0d]/80 via-60% to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/30" />
          </div>

          {/* Content — matches HeroCarousel text layout */}
          <div className="relative z-10 h-full flex flex-col justify-start pt-10 sm:pt-12 md:pt-14 px-6 sm:px-12 md:px-16 pb-16 max-w-[58%] sm:max-w-[52%] pointer-events-none space-y-4">
            <div className="inline-flex items-center gap-2 bg-accent-500/20 border border-accent-500/40 text-accent-400 text-[10px] font-black uppercase tracking-[0.18em] px-3 py-1.5 rounded-full w-fit">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              For Business
            </div>

            <h2 className="text-2xl sm:text-3xl md:text-5xl font-black text-white leading-tight">
              Buying for<br />a business?
            </h2>

            <p className="text-white/60 text-xs sm:text-sm leading-relaxed">
              Bulk discounts, GSTIN invoicing, and a dedicated account manager. Trusted by 500+ businesses across India.
            </p>

            <div className="flex flex-col gap-2 pt-1">
              {[
                { icon: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z', label: 'Tiered bulk pricing' },
                { icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', label: 'GST-compliant invoices' },
                { icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z', label: '24h RFQ turnaround' },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-2.5">
                  <svg className="w-3.5 h-3.5 text-accent-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                  </svg>
                  <span className="text-white/70 text-xs font-semibold">{item.label}</span>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-3 pt-1 pointer-events-auto">
              <a
                href={businessSignupUrl}
                className="inline-flex items-center gap-2 bg-accent-500 hover:bg-accent-400 text-white font-black text-xs sm:text-sm px-5 py-2.5 rounded-xl transition-all shadow-lg shadow-accent-500/25"
              >
                Register Now
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </a>
              <a
                href={businessLandingUrl}
                className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white font-bold text-xs sm:text-sm px-5 py-2.5 rounded-xl border border-white/15 transition-all"
              >
                Learn More
              </a>
            </div>
          </div>
        </div>
      </div>

      <ReviewCouponPopup />
    </div>
  )
}
