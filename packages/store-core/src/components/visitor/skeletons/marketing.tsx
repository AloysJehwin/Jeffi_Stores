import { Sk } from '@/components/admin/kit/skeleton'
import { ProductCardSkeleton } from './listing'
import { HomeLayoutSkeleton } from './sections'
import type { LayoutSection } from '@/lib/catalog/homepage-layout'

// About, support and home loading screens, shared by the storefront and the business portal.

type Portal = 'store' | 'business'

const CARD = 'bg-surface-elevated rounded-lg shadow-sm border border-border-default'

const WHY_US: [string, string, string][] = [
  [
    'Quality Products',
    'We stock only genuine, high-quality products from trusted brands like TVS, UNBRAKO, Taparia, and more.',
    'bg-primary-100',
  ],
  ['24/7 Support', 'Get round-the-clock assistance with our 24/7 support--always here when you need us!', 'bg-accent-100'],
  ['Wide Range', 'From bolts and nuts to power tools and belts, we have everything you need in one place.', 'bg-green-100'],
  ['Expert Team', 'Our knowledgeable staff is ready to help you find exactly what you need.', 'bg-purple-100'],
]

/** /about: the store name and the category cards shimmer; the copy is the page's own. */
export function AboutSkeleton() {
  return (
    <div className="bg-surface" role="status" aria-busy="true" aria-label="Loading about">
      <div className="bg-surface-elevated border-b border-border-default">
        <div className="container mx-auto px-4 py-4 sm:py-6 lg:py-8">
          <h1 className="flex flex-wrap items-center gap-x-3 text-3xl md:text-4xl font-bold text-secondary-500 dark:text-foreground mb-2">
            About <Sk className="inline-block h-9 w-48" />
          </h1>
          <p className="text-foreground-secondary">Your trusted partner for quality products and services</p>
        </div>
      </div>
      <div className="container mx-auto px-4 py-12">
        <div className={`${CARD} overflow-hidden mb-8`}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 p-4 sm:p-6 lg:p-8">
            <div>
              <h2 className="text-2xl font-bold text-foreground mb-6">Who We Are</h2>
              <p className="text-foreground-secondary mb-4 leading-relaxed">
                <Sk className="inline-block h-4 w-28 align-middle" /> is your trusted partner, offering a wide selection of
                quality products. We guarantee high availability of quality components for all your needs.
              </p>
              <p className="text-foreground-secondary mb-4 leading-relaxed">
                With years of experience, we&apos;ve built a reputation for reliability, quality, and exceptional customer
                service. Our mission is to keep your operations running smoothly with the right tools and products.
              </p>
              <p className="text-foreground-secondary mb-4 leading-relaxed">
                We ensure high availability of quality products and components. Count on us for reliable products and
                expert service to keep your operations seamless!
              </p>
            </div>
            <div>
              <h2 className="text-2xl font-bold text-foreground mb-6">Why Choose Us</h2>
              <div className="space-y-6">
                {WHY_US.map(([title, text, tone]) => (
                  <div key={title} className="flex items-start gap-4">
                    <div className={`w-12 h-12 rounded-lg flex-shrink-0 ${tone}`} />
                    <div>
                      <h3 className="font-semibold text-foreground mb-1">{title}</h3>
                      <p className="text-foreground-secondary text-sm">{text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className={`${CARD} p-4 sm:p-6 lg:p-8 mb-8`}>
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-2xl font-bold text-foreground">What We Offer</h2>
            <Sk className="h-6 w-24 rounded-full" />
          </div>
          <p className="text-foreground-secondary text-sm mb-6">Premium products from the brands you trust</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 border border-border-default rounded-xl p-4 bg-surface">
                <span aria-hidden className="sk block w-11 h-11 rounded-lg flex-shrink-0 bg-accent-100 dark:bg-accent-900/30" />
                <div className="flex-1 space-y-1.5">
                  <Sk className="h-4 w-2/3" />
                  <Sk className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-8 text-center">
            <span className="inline-flex items-center gap-2 bg-accent-500 text-white px-8 py-3 rounded-lg font-semibold">
              View All Categories
            </span>
          </div>
        </div>
        <div className="bg-gradient-to-r from-primary-600 to-primary-800 rounded-lg shadow-sm p-4 sm:p-6 lg:p-8 text-center text-white">
          <h2 className="text-3xl font-bold mb-4">Ready to Get Started?</h2>
          <p className="text-lg mb-6 text-primary-50">Contact us today for all your product and service needs.</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <span className="bg-accent-500 text-white px-8 py-3 rounded-lg font-semibold">Contact Us</span>
            <span className="bg-surface-elevated text-primary-700 px-8 py-3 rounded-lg font-semibold">Browse Products</span>
          </div>
        </div>
      </div>
    </div>
  )
}

const QUICK_LINKS: Record<Portal, string[]> = {
  store: ['My Orders', 'My Account', 'Wishlist', 'Browse Products', 'All Categories', 'About Us'],
  business: ['My Orders', 'My Quotes', 'My Account', 'Browse Products', 'All Categories', 'About Us'],
}

const LEGAL_LINKS = [
  'Privacy Policy',
  'Terms & Conditions',
  'Return & Refund Policy',
  'Shipping Policy',
  'Cancellation Policy',
  'Warranty Policy',
  'FAQ',
  'Grievance Redressal',
]

function LinkList({ title, links }: { title: string; links: string[] }) {
  return (
    <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
      <h2 className="font-bold text-foreground text-sm mb-3">{title}</h2>
      <div className="divide-y divide-border-default">
        {links.map(l => (
          <div key={l} className="flex items-center justify-between py-2 text-sm text-foreground-secondary">
            {l}
            <svg className="w-3.5 h-3.5 text-foreground-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        ))}
      </div>
    </div>
  )
}

/** /support: contact details shimmer; the link lists and headings are the page's own. */
export function SupportSkeleton({ portal = 'store' }: { portal?: Portal }) {
  return (
    <div className="bg-surface min-h-screen" role="status" aria-busy="true" aria-label="Loading support">
      <div className="container mx-auto px-4 py-8 md:py-12">
        <div className="mb-6 md:mb-8">
          <p className="text-accent-500 text-xs font-bold uppercase tracking-widest mb-1">Help &amp; Support</p>
          <h1 className="text-3xl md:text-4xl font-extrabold text-foreground">How can we help?</h1>
          <p className="text-foreground-secondary mt-1.5 text-sm">Chat with our support bot or reach us directly.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8 md:mb-10">
          <div className="bg-surface-elevated rounded-xl border border-border-default p-5 space-y-4">
            <h2 className="font-bold text-foreground text-sm">Contact Us</h2>
            {['Phone', 'Email', 'Address'].map(l => (
              <div key={l}>
                <p className="text-xs text-foreground-muted mb-1">{l}</p>
                <Sk className="h-4 w-40 max-w-full" />
              </div>
            ))}
            <div className="pt-1 border-t border-border-default">
              <p className="text-xs text-foreground-muted mb-1.5">Business Hours</p>
              <div className="space-y-1.5">
                {[0, 1, 2].map(i => (
                  <div key={i} className="flex justify-between gap-3">
                    <Sk className="h-3 w-16" />
                    <Sk className="h-3 w-20" />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <LinkList title="Quick Links" links={QUICK_LINKS[portal]} />
          <LinkList title="Legal & Policies" links={LEGAL_LINKS} />
        </div>
        <div className="mb-2">
          <p className="text-accent-500 text-xs font-bold uppercase tracking-widest mb-1">Support Chat</p>
          <h2 className="text-xl md:text-2xl font-extrabold text-foreground mb-4">Chat with us</h2>
        </div>
        <Sk className="w-full h-[65vh] min-h-[480px] max-h-[680px] rounded-2xl" />
      </div>
    </div>
  )
}

/** The section-driven home page: the hero, then a product row. */
export function HomeSkeleton() {
  return (
    <div className="bg-surface" role="status" aria-busy="true" aria-label="Loading home">
      <div className="bg-surface px-3 sm:px-6 md:px-8 pt-3 pb-0 md:pt-6 h-[clamp(20rem,60svh,32rem)] sm:h-[clamp(22rem,58svh,34rem)] lg:h-[clamp(24rem,56svh,38rem)]">
        <Sk className="w-full h-full rounded-2xl" />
      </div>
      <section className="py-12 md:py-20 bg-surface-secondary">
        <div className="container mx-auto px-4">
          <div className="flex items-end justify-between mb-7">
            <div className="flex items-center gap-4">
              <div className="w-1 h-10 bg-primary-500 rounded-full" />
              <div className="space-y-2">
                <Sk className="h-2.5 w-20" />
                <Sk className="h-7 md:h-9 w-56 max-w-full" />
              </div>
            </div>
            <Sk className="h-4 w-16" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

/**
 * The business home renders its own fixed header (signed-in or public); this holds its place.
 * `sections`: the published business homepage's layout; null while none is published.
 */
export function BusinessHomeSkeleton({ sections }: { sections?: LayoutSection[] | null }) {
  return (
    <div className="bg-surface min-h-screen">
      <div className="bg-surface-elevated shadow-sm dark:shadow-none dark:border-b dark:border-border-default fixed top-0 left-0 right-0 z-40 w-full">
        <div className="container mx-auto px-3 sm:px-4">
          <div className="flex items-center justify-between h-16 lg:h-20 gap-2">
            <Sk className="h-8 w-36 rounded-lg" />
            <div className="flex items-center gap-2">
              <Sk className="h-9 w-20 rounded-lg" />
              <Sk className="h-9 w-9 rounded-lg" />
            </div>
          </div>
        </div>
      </div>
      <main className="pt-16 lg:pt-20">
        {sections ? <HomeLayoutSkeleton sections={sections} /> : <HomeSkeleton />}
      </main>
    </div>
  )
}
