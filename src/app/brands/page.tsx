import Link from 'next/link'
import { queryMany } from '@/lib/db'

export const dynamic = 'force-dynamic'

async function getBrandsWithCounts() {
  return queryMany<{
    id: string
    name: string
    slug: string
    description: string | null
    logo_url: string | null
    product_count: string
  }>(`
    SELECT b.id, b.name, b.slug, b.description, b.logo_url,
      COUNT(p.id) FILTER (WHERE p.is_active = true) AS product_count
    FROM brands b
    LEFT JOIN products p ON p.brand_id = b.id
    WHERE b.is_active = true
    GROUP BY b.id
    ORDER BY b.name ASC
  `)
}

export default async function BrandsPage() {
  const brands = await getBrandsWithCounts()

  return (
    <div className="bg-surface min-h-screen">
      <div className="bg-surface-elevated border-b border-border-default">
        <div className="container mx-auto px-4 py-4 sm:py-6 lg:py-8">
          <h1 className="text-3xl md:text-4xl font-bold text-secondary-500 dark:text-foreground mb-2">All Brands</h1>
          <p className="text-foreground-secondary">Browse products by brand</p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-4 sm:py-6 lg:py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {brands.map(brand => {
            const count = parseInt(brand.product_count, 10)
            return (
              <div
                key={brand.id}
                className="bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden hover:shadow-lg transition-shadow"
              >
                <Link href={`/brands/${brand.slug}`} className="block p-4 sm:p-6 group">
                  <div className="flex items-start gap-4 mb-4">
                    <div className="w-16 h-16 bg-surface-secondary rounded-lg flex items-center justify-center flex-shrink-0 border border-border-default overflow-hidden">
                      {brand.logo_url ? (
                        <img src={brand.logo_url} alt={brand.name} className="w-full h-full object-contain p-1" />
                      ) : (
                        <svg
                          className="w-8 h-8 text-foreground-muted"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.5}
                            d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z"
                          />
                        </svg>
                      )}
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-foreground group-hover:text-accent-600 dark:group-hover:text-accent-400 transition-colors">
                        {brand.name}
                      </h2>
                      <p className="text-sm text-foreground-muted mt-1">
                        {count} {count === 1 ? 'product' : 'products'}
                      </p>
                    </div>
                  </div>

                  {brand.description && (
                    <p className="text-sm text-foreground-secondary mb-4 line-clamp-2">{brand.description}</p>
                  )}

                  <div className="flex items-center text-accent-500 group-hover:text-accent-600 font-semibold text-sm">
                    Browse Products
                    <svg
                      className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </Link>
              </div>
            )
          })}
        </div>

        {brands.length === 0 && (
          <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-12 text-center">
            <svg
              className="mx-auto h-24 w-24 text-foreground-muted mb-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z"
              />
            </svg>
            <h3 className="text-xl font-semibold text-foreground mb-2">No Brands Yet</h3>
            <p className="text-foreground-secondary mb-6">Check back soon!</p>
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
  )
}
