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
      {/* Hero Section */}
      <section className="relative bg-gradient-to-r from-primary-600 to-primary-800 text-white">
        <div className="container mx-auto px-4 py-16 md:py-24">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            <div>
              <h1 className="text-4xl md:text-6xl font-bold mb-4">
                Jeffi Stores
              </h1>
              <h2 className="text-2xl md:text-3xl font-semibold mb-6 text-primary-100">
                Hardware and Tools
              </h2>
              <p className="text-lg mb-8 text-primary-50">
                Your trusted hardware store with a wide range of industrial machinery parts.
                We ensure high availability of quality components for manufacturing, construction,
                and repairs. Get reliable products and expert service to keep your operations running smoothly!
              </p>
              <div className="flex gap-4">
                <Link
                  href="/products"
                  className="bg-accent-500 hover:bg-accent-600 text-white px-8 py-3 rounded-lg font-semibold transition-colors"
                >
                  Shop Now
                </Link>
                <Link
                  href="/categories"
                  className="bg-surface-elevated text-primary-700 hover:bg-surface-secondary px-8 py-3 rounded-lg font-semibold transition-colors"
                >
                  Browse Categories
                </Link>
              </div>
            </div>
            <div className="hidden md:block">
              <div className="relative h-96">
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

      {/* Categories Section */}
      {mainCategories.length > 0 && (
        <section className="py-16 bg-surface">
          <div className="container mx-auto px-4">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-secondary-500 mb-4">
                Shop by Category
              </h2>
              <p className="text-foreground-secondary">
                Browse our wide range of hardware and industrial tools
              </p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6">
              {mainCategories.map((category) => (
                <Link
                  key={category.id}
                  href={`/categories/${category.slug}`}
                  className="group"
                >
                  <div className="bg-surface-elevated rounded-lg p-4 sm:p-6 shadow-sm border border-border-default hover:border-accent-500 hover:shadow-md transition-all">
                    <div className="flex flex-col items-center text-center">
                      <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mb-4 group-hover:bg-accent-100 transition-colors">
                        <CategoryIcon
                          categoryName={category.name}
                          className="w-8 h-8 text-primary-600 dark:text-primary-400 group-hover:text-accent-600"
                        />
                      </div>
                      <h3 className="font-semibold text-foreground group-hover:text-accent-600 transition-colors">
                        {category.name}
                      </h3>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
            <div className="text-center mt-8">
              <Link
                href="/categories"
                className="text-accent-500 hover:text-accent-600 font-semibold inline-flex items-center"
              >
                View All Categories
                <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Featured Products Section */}
      {featuredProducts.length > 0 && (
        <section className="py-16">
          <div className="container mx-auto px-4">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-secondary-500 mb-4">
                Featured Products
              </h2>
              <p className="text-foreground-secondary">
                Check out our most popular and trusted products
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
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
                  <Link
                    key={product.id}
                    href={`/products/${product.slug}`}
                    className="group"
                  >
                    <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden hover:shadow-lg transition-shadow">
                      {/* Product Image */}
                      <div className="relative h-64 bg-surface-elevated overflow-hidden">
                        {primaryImage ? (
                          <img
                            src={primaryImage.image_url}
                            alt={product.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <svg className="w-24 h-24 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          </div>
                        )}
                        {mrpDiscount > 0 && (
                          <div className="absolute top-4 right-4 bg-accent-500 text-white px-3 py-1 rounded-full text-sm font-semibold">
                            {mrpDiscount}% off
                          </div>
                        )}
                      </div>

                      {/* Product Info */}
                      <div className="p-4 sm:p-6">
                        <h3 className="font-semibold text-lg text-foreground mb-2 group-hover:text-accent-600 transition-colors line-clamp-2">
                          {product.name}
                        </h3>
                        {product.brands && (
                          <p className="text-sm text-foreground-muted mb-3">
                            Brand: {product.brands.name}
                          </p>
                        )}
                        <div className="flex items-baseline gap-2 mb-1">
                          <span className="text-2xl font-bold text-primary-600 dark:text-primary-400">
                            {hasVariants ? 'From ' : ''}₹{Number(displayPrice).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </span>
                          {mrp && mrp > Number(displayPrice) && (
                            <span className="text-sm text-foreground-muted line-through">
                              ₹{mrp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-foreground-muted mb-4">Inclusive of all taxes</p>
                        <div className="flex items-center justify-between">
                          <span className={`text-sm font-medium ${effectiveStock > 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {effectiveStock > 0 ? 'In Stock' : 'Out of Stock'}
                          </span>
                          <span className="text-accent-500 group-hover:text-accent-600 font-semibold">
                            View Details →
                          </span>
                        </div>
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
            <div className="text-center mt-12">
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

      {/* Features Section */}
      <section className="py-16 bg-surface">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
            <div className="bg-surface-elevated rounded-lg p-4 sm:p-6 lg:p-8 shadow-sm border border-border-default">
              <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mb-6">
                <svg className="w-8 h-8 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-foreground mb-3">24/7 Service</h3>
              <p className="text-foreground-secondary">
                Get round-the-clock assistance with our 24/7 support—always here when you need us!
              </p>
            </div>

            <div className="bg-surface-elevated rounded-lg p-4 sm:p-6 lg:p-8 shadow-sm border border-border-default">
              <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mb-6">
                <svg className="w-8 h-8 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-foreground mb-3">Instant Assistance</h3>
              <p className="text-foreground-secondary">
                Instant assistance anytime with our 24/7 immediate support!
              </p>
            </div>

            <div className="bg-surface-elevated rounded-lg p-4 sm:p-6 lg:p-8 shadow-sm border border-border-default">
              <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mb-6">
                <svg className="w-8 h-8 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-foreground mb-3">Contact Our Team</h3>
              <p className="text-foreground-secondary">
                They are here to help you. Reach out anytime for expert guidance and support.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* About Section */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl md:text-4xl font-bold text-secondary-500 mb-6">
                About Jeffi Stores
              </h2>
              <p className="text-foreground-secondary mb-6 leading-relaxed">
                Jeffi Stores is your trusted hardware partner, offering a wide selection of industrial
                machinery parts. We guarantee high availability of quality components for manufacturing,
                construction, and repairs.
              </p>
              <p className="text-foreground-secondary mb-8 leading-relaxed">
                Count on us for reliable products and expert service to keep your operations seamless!
              </p>
              <Link
                href="/about"
                className="text-accent-500 hover:text-accent-600 font-semibold inline-flex items-center"
              >
                Learn More About Us
                <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
            <div className="relative h-96 bg-surface-secondary rounded-lg flex items-center justify-center">
              <svg className="w-48 h-48 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
