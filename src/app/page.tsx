import Link from 'next/link'
import { queryMany } from '@/lib/db'
import { heroSlideHref } from '@/lib/hero-slides'
import { VARIANT_MIN_PRICE_INCL_GST_SQL, VARIANT_MIN_PRICE_EX_GST_SQL, VARIANT_MIN_MRP_SQL, VARIANT_STOCK_TOTAL_SQL } from '@/lib/queries'
import CategoryIcon from '@/components/visitor/CategoryIcon'
import ReviewCouponPopup from '@/components/visitor/ReviewCouponPopup'
import ProductCard from '@/components/visitor/ProductCard'
import HeroCarousel from '@/components/visitor/HeroCarousel'
import FeaturedForYou from '@/components/visitor/FeaturedForYou'
import { getHost } from '@/lib/get-host'
import { getStorefrontContent, getFeatureFlags } from '@/lib/site-controls'
import { pickUnitPrice } from '@/lib/pricing'

export const revalidate = 120

async function getFeaturedProducts(limit: number, gstEnabled: boolean) {
  const MIN_PRICE_SQL = gstEnabled ? VARIANT_MIN_PRICE_INCL_GST_SQL : VARIANT_MIN_PRICE_EX_GST_SQL
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
      ${MIN_PRICE_SQL} AS variant_min_price,
      ${VARIANT_MIN_MRP_SQL} AS variant_min_mrp
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE p.is_featured = true AND p.is_active = true
    LIMIT $1
  `, [limit])
}

async function getNewArrivals(limit: number, gstEnabled: boolean) {
  const MIN_PRICE_SQL = gstEnabled ? VARIANT_MIN_PRICE_INCL_GST_SQL : VARIANT_MIN_PRICE_EX_GST_SQL
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
      ${MIN_PRICE_SQL} AS variant_min_price,
      ${VARIANT_MIN_MRP_SQL} AS variant_min_mrp
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE p.is_active = true
    ORDER BY p.created_at DESC
    LIMIT $1
  `, [limit])
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
  // Prefer admin-managed hero_slides. Each carries its own copy, image and a CTA
  // link built from assigned product filters (or a manual URL).
  const managed = await queryMany<any>(
    `SELECT * FROM hero_slides WHERE is_active = true ORDER BY display_order ASC, created_at ASC`
  )
  if (managed.length > 0) {
    return managed.map(s => ({
      id: s.id,
      title: s.title,
      subtitle: s.subtitle,
      badge_text: s.badge_text,
      badge_color: s.badge_color,
      image_url: s.image_url,
      image_url_mobile: s.image_url_mobile,
      href: heroSlideHref(s),
    }))
  }

  // Fallback: derive slides from active parent categories (legacy behaviour).
  // Pick 4 categories daily using a date-seeded deterministic shuffle.
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

function productCardProps(product: any, gstEnabled: boolean) {
  const primaryImage = product.product_images?.find((img: any) => img.is_primary) || product.product_images?.[0]
  const hasVariants = product.has_variants
  const displayPrice = hasVariants && product.variant_min_price
    ? Number(product.variant_min_price)
    : pickUnitPrice({ inclusive: Number(product.base_price), exGst: product.price_ex_gst != null ? Number(product.price_ex_gst) : undefined }, gstEnabled)
  const effectiveStock = hasVariants ? Number(product.variant_stock_total) : (product.stock_status !== 'Out of Stock' ? 1 : 0)
  const rawMrp = product.mrp ? Number(product.mrp) : (product.variant_min_mrp ? Number(product.variant_min_mrp) : null)
  // MRP is stored GST-inclusive. When GST is off, displayPrice is ex-GST, so put
  // the MRP on the same ex-GST basis before computing the discount / strike-through.
  const gstRate = Number(product.gst_percentage ?? 0)
  const mrp = (!gstEnabled && rawMrp != null && gstRate > 0) ? rawMrp / (1 + gstRate / 100) : rawMrp
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

async function getBestSellers(gstEnabled: boolean) {
  const MIN_PRICE_SQL = gstEnabled ? VARIANT_MIN_PRICE_INCL_GST_SQL : VARIANT_MIN_PRICE_EX_GST_SQL
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
      ${MIN_PRICE_SQL} AS variant_min_price,
      ${VARIANT_MIN_MRP_SQL} AS variant_min_mrp,
      COALESCE((SELECT SUM(oi.quantity) FROM order_items oi WHERE oi.product_id = p.id), 0) AS total_sold
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE p.is_active = true
    ORDER BY total_sold DESC, p.created_at DESC
    LIMIT 8
  `)
}

async function getTopBrands() {
  return queryMany<{ id: string; name: string; slug: string; product_count: number }>(`
    SELECT b.id, b.name, b.slug, COUNT(p.id)::int AS product_count
    FROM brands b
    JOIN products p ON p.brand_id = b.id AND p.is_active = true
    GROUP BY b.id, b.name, b.slug
    HAVING COUNT(p.id) >= 2
    ORDER BY COUNT(p.id) DESC
    LIMIT 8
  `)
}

async function getDealOfTheDay(gstEnabled: boolean) {
  const MIN_PRICE_SQL = gstEnabled ? VARIANT_MIN_PRICE_INCL_GST_SQL : VARIANT_MIN_PRICE_EX_GST_SQL
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
      ${MIN_PRICE_SQL} AS variant_min_price,
      ${VARIANT_MIN_MRP_SQL} AS variant_min_mrp
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE p.is_active = true AND p.is_featured = true
    ORDER BY RANDOM()
    LIMIT 4
  `)
}

async function getFreeShippingThreshold() {
  // Use the SAME setting checkout/shipping uses (delivery_free_threshold) so the
  // homepage always matches the real free-delivery threshold — not the stale,
  // separate 'free_shipping_threshold' key.
  const { getDeliverySettings } = await import('@/lib/delivery-settings')
  const { freeThreshold } = await getDeliverySettings()
  return freeThreshold
}

async function getCategoryShowcase() {
  const categories = await queryMany<{ id: string; name: string; slug: string }>(`
    SELECT c.id, c.name, c.slug FROM categories c
    JOIN categories sub ON sub.parent_category_id = c.id
    JOIN products p ON p.category_id = sub.id AND p.is_active = true
    WHERE c.parent_category_id IS NULL AND c.is_active = true
    GROUP BY c.id, c.name, c.slug
    HAVING COUNT(p.id) >= 2
    ORDER BY COUNT(p.id) DESC LIMIT 4
  `)
  const result = await Promise.all(categories.map(async cat => {
    const products = await queryMany(`
      SELECT p.id, p.name, p.slug, p.has_variants,
        p.base_price, p.price_ex_gst, p.discount_pct,
        (SELECT json_agg(json_build_object('image_url', pi2.image_url, 'thumbnail_url', pi2.thumbnail_url))
          FROM product_images pi2 WHERE pi2.product_id = p.id LIMIT 1) AS product_images,
        MIN(pv.price) FILTER (WHERE pv.is_active) AS variant_min_price
      FROM products p
      JOIN categories sub ON p.category_id = sub.id AND sub.parent_category_id = $1
      LEFT JOIN product_variants pv ON pv.product_id = p.id
      WHERE p.is_active = true
      GROUP BY p.id
      ORDER BY p.is_featured DESC, p.created_at DESC
      LIMIT 5
    `, [cat.id])
    return { ...cat, products }
  }))
  return result.filter(c => c.products.length >= 2)
}

export default async function HomePage() {
  const storefront = await getStorefrontContent()
  const { gstEnabled } = await getFeatureFlags()

  // Homepage stats tiles — admin-editable JSON, fall back to defaults.
  const DEFAULT_STATS = [
    { value: '10+', label: 'Years in Business' },
    { value: '1000+', label: 'Happy Customers' },
  ]
  let stats: { value: string; label: string }[] = DEFAULT_STATS
  if (storefront.statsJson.trim()) {
    try {
      const parsed = JSON.parse(storefront.statsJson)
      if (Array.isArray(parsed) && parsed.length && parsed.every(s => s && typeof s.value === 'string' && typeof s.label === 'string')) {
        stats = parsed
      }
    } catch { /* keep defaults */ }
  }
  const aboutCopy = storefront.aboutCopy.trim() ||
    'Jeffi Stores is built for industry — offering machinery parts, fasteners, tools, and electrical components for manufacturing, construction, and industrial repairs.'

  const [featuredProducts, newArrivals, mainCategories, heroSlides, categoryShowcase, bestSellers, topBrands, freeShippingThreshold] = await Promise.all([
    getFeaturedProducts(storefront.featuredLimit, gstEnabled),
    getNewArrivals(storefront.newArrivalsLimit, gstEnabled),
    getMainCategories(),
    getHeroSlides(),
    getCategoryShowcase(),
    getBestSellers(gstEnabled),
    getTopBrands(),
    getFreeShippingThreshold(),
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

      {/* ── Trust Strip ── */}
      <div className="bg-surface-elevated border-b border-border-default">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 divide-x-0 sm:divide-x divide-border-default">
            {[
              { icon: 'M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m6 0a2 2 0 104 0', label: `Free delivery above ₹${freeShippingThreshold.toLocaleString('en-IN')}` },
              { icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', label: 'GST invoice on every order' },
              { icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10', label: '10,000+ products in stock' },
              { icon: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z', label: 'Cash on delivery available' },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 sm:justify-center min-w-0">
                <svg className="w-5 h-5 text-accent-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                </svg>
                <span className="text-xs font-semibold text-foreground-secondary leading-tight min-w-0">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

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

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3 lg:grid-cols-8">
              {mainCategories.map((category) => (
                <Link key={category.id} href={`/categories/${category.slug}`} className="group">
                  <div className="flex flex-col items-center text-center gap-2.5 p-3 sm:p-4 rounded-2xl bg-surface-elevated border border-border-default
                                  hover:border-primary-400/60 hover:bg-primary-50 dark:hover:bg-primary-900/10 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200">
                    <div className="w-12 h-12 bg-primary-100 dark:bg-primary-900/25 rounded-xl flex items-center justify-center group-hover:bg-primary-200 dark:group-hover:bg-primary-800/40 transition-colors shrink-0">
                      <CategoryIcon categoryName={category.name} className="w-6 h-6 text-primary-600 dark:text-primary-400" />
                    </div>
                    <span className="text-xs font-bold text-foreground group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors leading-tight line-clamp-2 flex items-center justify-center min-h-[2.25rem] min-w-0 px-0.5">
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
                <ProductCard key={product.id} {...productCardProps(product, gstEnabled)} />
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

      {/* ── Shop by Brand ── */}
      {topBrands.length > 0 && (
        <section className="py-8 bg-surface-elevated border-y border-border-default">
          <div className="container mx-auto px-4">
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="text-primary-500 text-[10px] font-black uppercase tracking-[0.2em] mb-0.5">Trusted Names</p>
                <h2 className="text-xl md:text-2xl font-black text-foreground tracking-tight">Shop by Brand</h2>
              </div>
              <Link href="/brands" className="hidden sm:flex items-center gap-1 text-sm text-accent-500 hover:text-accent-400 font-semibold shrink-0 transition-colors">
                All brands <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
              </Link>
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-3">
              {topBrands.map(brand => (
                <Link key={brand.id} href={`/brands/${brand.slug}`}
                  className="flex flex-col items-center gap-2 p-3 rounded-xl bg-surface border border-border-default hover:border-accent-500/40 hover:bg-surface-secondary transition-all group">
                  <div className="w-10 h-10 rounded-full bg-accent-500/10 flex items-center justify-center">
                    <span className="text-accent-600 dark:text-accent-400 text-xs font-black">{brand.name.slice(0, 2).toUpperCase()}</span>
                  </div>
                  <span className="text-[11px] font-semibold text-foreground text-center leading-tight line-clamp-2">{brand.name}</span>
                  <span className="text-[10px] text-foreground-muted">{brand.product_count} items</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── New Arrivals ── */}      {newArrivals.length > 0 && (
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
                <ProductCard key={product.id} {...productCardProps(product, gstEnabled)} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Category Showcase ── */}
      {categoryShowcase.length > 0 && (
        <section className="py-10 md:py-14">
          <div className="container mx-auto px-4">
            <div className="flex items-end justify-between mb-6">
              <div>
                <p className="text-accent-500 text-[10px] font-black uppercase tracking-[0.2em] mb-1">Shop by Category</p>
                <h2 className="text-2xl md:text-3xl font-black text-foreground tracking-tight">Top Categories</h2>
              </div>
              <Link href="/categories" className="hidden sm:flex items-center gap-1 text-sm text-accent-500 hover:text-accent-400 font-semibold shrink-0 transition-colors">
                All categories
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
              </Link>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {categoryShowcase.map((cat: any) => (
                <div key={cat.id} className="bg-surface-elevated rounded-2xl border border-border-default overflow-hidden hover:border-accent-500/40 hover:shadow-lg transition-all duration-200">
                  {/* Category title */}
                  <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                    <Link href={`/categories/${cat.slug}`} className="font-bold text-foreground hover:text-accent-500 transition-colors text-sm leading-tight">
                      {cat.name}
                    </Link>
                    <Link href={`/categories/${cat.slug}`} className="text-[10px] text-accent-500 hover:text-accent-400 font-semibold whitespace-nowrap ml-2 flex-shrink-0">
                      See all
                    </Link>
                  </div>
                  {/* 2×2 product thumbnails */}
                  <div className="grid grid-cols-2 gap-1 p-2 pt-1">
                    {cat.products.slice(0, 4).map((p: any) => {
                      const img = p.product_images?.[0]
                      const price = p.has_variants && p.variant_min_price ? Number(p.variant_min_price) : pickUnitPrice({ inclusive: Number(p.base_price), exGst: p.price_ex_gst != null ? Number(p.price_ex_gst) : undefined }, gstEnabled)
                      return (
                        <Link key={p.id} href={`/products/${p.slug}`}
                          className="group bg-surface rounded-xl p-2 flex flex-col gap-1.5 hover:bg-surface-secondary transition-colors">
                          <div className="aspect-square overflow-hidden rounded-lg bg-surface-secondary flex items-center justify-center">
                            {img ? (
                              <img src={img.thumbnail_url || img.image_url} alt={p.name}
                                className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300" />
                            ) : (
                              <div className="w-full h-full bg-surface-secondary rounded-lg" />
                            )}
                          </div>
                          <p className="text-[11px] font-medium text-foreground line-clamp-2 leading-tight">{p.name}</p>
                          <p className="text-[11px] font-bold text-accent-500">₹{price.toLocaleString('en-IN')}</p>
                        </Link>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Featured For You (personalised; hidden for logged-out) ── */}
      <FeaturedForYou />

      {/* ── Best Sellers ── */}
      {bestSellers.length > 0 && (
        <section className="py-12 md:py-16 bg-surface-secondary">
          <div className="container mx-auto px-4">
            <div className="flex items-end justify-between mb-7">
              <div>
                <p className="text-accent-500 text-[10px] font-black uppercase tracking-[0.2em] mb-1">Most Ordered</p>
                <h2 className="text-2xl md:text-3xl font-black text-foreground tracking-tight">Best Sellers</h2>
              </div>
              <Link href="/products?sort=bestsellers" className="hidden sm:flex items-center gap-1 text-sm text-accent-500 hover:text-accent-400 font-semibold shrink-0 transition-colors">
                View all <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
              </Link>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {bestSellers.map((product: any) => (
                <ProductCard key={product.id} {...productCardProps(product, gstEnabled)} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── GST & Business Benefits ── */}
      <section className="py-8 bg-surface border-y border-border-default">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', title: 'Save up to 18% with GST', sub: 'Claim input tax credit on every purchase with a valid GSTIN invoice' },
              { icon: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z', title: 'Bulk order discounts', sub: 'Special pricing for businesses ordering in volume — contact us for a quote' },
              { icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z', title: 'Dedicated account manager', sub: 'Registered businesses get priority support and a personal account manager' },
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-3 p-4 rounded-xl bg-surface-elevated border border-border-default">
                <div className="w-10 h-10 rounded-lg bg-accent-500/10 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-accent-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-bold text-foreground">{item.title}</p>
                  <p className="text-xs text-foreground-secondary mt-0.5 leading-relaxed">{item.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

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
                {stats.map((s, i) => (
                  <div key={i} className="bg-white/10 backdrop-blur-md rounded-xl px-4 py-3 border border-white/15 flex-1">
                    <p className="text-white font-black text-2xl">{s.value}</p>
                    <p className="text-white/60 text-xs font-semibold mt-0.5">{s.label}</p>
                  </div>
                ))}
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
                {aboutCopy}
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
