export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { headers } from 'next/headers'
import { bp } from '@/lib/business-path'
import { queryMany } from '@/lib/db'
import { getStoreIdentity } from '@/lib/site-controls'
import CategoryIcon from '@/components/visitor/CategoryIcon'

const CATEGORY_BRANDS: Record<string, string> = {
  'Bolts & Nuts': 'TVS, UNBRAKO',
  Screws: 'LandMark',
  'Drill Bits': 'Miranda, Totem',
  Tools: 'Taparia, Forves Kento',
  'V Belts': 'IPON VEE Grip, Fenner, Nickson, PIX',
  'Timing Belts': 'Gates, Fenner, Contitech',
  'SS Fasteners': 'APL, Unbrako, TVS, LPS',
  'Welding Rods': 'Ador, Esab, Mangalam',
  Valves: 'Spirax, Forves Marshall, Exxon',
}

const CATEGORY_COLORS: Record<string, string> = {
  'Bolts & Nuts': 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
  Screws: 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400',
  'Drill Bits': 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
  Tools: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400',
  'V Belts': 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400',
  'Timing Belts': 'bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400',
  'SS Fasteners': 'bg-slate-100 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300',
  'Welding Rods': 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
  Valves: 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400',
}

export default async function BusinessAboutPage() {
  const [hdrs, identity, categories] = await Promise.all([
    headers(),
    getStoreIdentity(),
    queryMany<{ id: string; name: string; icon_name: string | null }>(
      `SELECT id, name, icon_name FROM categories WHERE is_active = true AND parent_category_id IS NULL ORDER BY display_order ASC`
    ).catch(() => []),
  ])
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host') ?? ''
  return (
    <div className="bg-surface">
      <div className="bg-surface-elevated border-b border-border-default">
        <div className="container mx-auto px-4 py-4 sm:py-6 lg:py-8">
          <h1 className="text-3xl md:text-4xl font-bold text-secondary-500 dark:text-foreground mb-2">
            About {identity.name}
          </h1>
          <p className="text-foreground-secondary">Your trusted partner for quality products and services</p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-12">
        <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden mb-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 p-4 sm:p-6 lg:p-8">
            <div>
              <h2 className="text-2xl font-bold text-foreground mb-6">Who We Are</h2>
              <div className="prose prose-gray dark:prose-invert">
                <p className="text-foreground-secondary mb-4 leading-relaxed">
                  {identity.name} is your trusted partner, offering a wide selection of quality products. We guarantee
                  high availability of quality components for all your needs.
                </p>
                <p className="text-foreground-secondary mb-4 leading-relaxed">
                  With years of experience, we&apos;ve built a reputation for reliability, quality, and exceptional
                  customer service. Our mission is to keep your operations running smoothly with the right tools and
                  products.
                </p>
                <p className="text-foreground-secondary mb-4 leading-relaxed">
                  We ensure high availability of quality products and components. Count on us for reliable products and
                  expert service to keep your operations seamless!
                </p>
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-foreground mb-6">Why Choose Us</h2>
              <div className="space-y-6">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <svg className="w-6 h-6 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground mb-1">Quality Products</h3>
                    <p className="text-foreground-secondary text-sm">
                      We stock only genuine, high-quality products from trusted brands like TVS, UNBRAKO, Taparia, and
                      more.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-accent-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <svg className="w-6 h-6 text-accent-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground mb-1">24/7 Support</h3>
                    <p className="text-foreground-secondary text-sm">
                      Get round-the-clock assistance with our 24/7 support--always here when you need us!
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                      />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground mb-1">Wide Range</h3>
                    <p className="text-foreground-secondary text-sm">
                      From bolts and nuts to power tools and belts, we have everything you need in one place.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <svg className="w-6 h-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                      />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground mb-1">Expert Team</h3>
                    <p className="text-foreground-secondary text-sm">
                      Our knowledgeable staff is ready to help you find exactly what you need.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-6 lg:p-8 mb-8">
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-2xl font-bold text-foreground">What We Offer</h2>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-accent-100 dark:bg-accent-900/30 text-accent-700 dark:text-accent-400">
              {categories.length} Categories
            </span>
          </div>
          <p className="text-foreground-secondary text-sm mb-6">Premium products from the brands you trust</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {categories.map(cat => (
              <div
                key={cat.id}
                className="group flex items-start gap-4 border border-border-default rounded-xl p-4 hover:border-accent-400 hover:shadow-sm transition-all bg-surface hover:bg-surface-elevated"
              >
                <div
                  className={`w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 ${CATEGORY_COLORS[cat.name] ?? 'bg-accent-100 dark:bg-accent-900/30 text-accent-600 dark:text-accent-400'}`}
                >
                  <CategoryIcon iconName={cat.icon_name} categoryName={cat.name} className="w-6 h-6" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-foreground mb-1 group-hover:text-accent-600 transition-colors">
                    {cat.name}
                  </h3>
                  <p className="text-xs text-foreground-muted leading-relaxed">{CATEGORY_BRANDS[cat.name] ?? ''}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-8 text-center">
            <Link
              href={bp('/business/categories', host)}
              className="inline-flex items-center gap-2 bg-accent-500 hover:bg-accent-600 text-white px-8 py-3 rounded-lg font-semibold transition-colors"
            >
              View All Categories
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>

        <div className="bg-gradient-to-r from-primary-600 to-primary-800 rounded-lg shadow-sm p-4 sm:p-6 lg:p-8 text-center text-white">
          <h2 className="text-3xl font-bold mb-4">Ready to Get Started?</h2>
          <p className="text-lg mb-6 text-primary-50">Contact us today for all your product and service needs.</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href={bp('/business/support', host)}
              className="bg-accent-500 hover:bg-accent-600 text-white px-8 py-3 rounded-lg font-semibold transition-colors"
            >
              Contact Us
            </Link>
            <Link
              href={bp('/business/products', host)}
              className="bg-surface-elevated text-primary-700 hover:bg-surface-secondary px-8 py-3 rounded-lg font-semibold transition-colors"
            >
              Browse Products
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
