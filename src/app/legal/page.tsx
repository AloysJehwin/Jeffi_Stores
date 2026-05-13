import Link from 'next/link'
import { policies } from './policies'

export const metadata = {
  title: 'Legal & Policies | Jeffi Stores',
  description: 'Privacy policy, terms & conditions, shipping, returns, and other legal documents for Jeffi Stores.',
}

const icons: Record<string, React.ReactNode> = {
  'privacy-policy': (
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
  ),
  'terms-and-conditions': (
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  ),
  'return-refund-policy': (
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
  ),
  'shipping-policy': (
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
  ),
  'cancellation-policy': (
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
  ),
  'warranty-policy': (
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
  ),
  'faq': (
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  ),
  'grievance-redressal': (
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
  ),
}

export default function LegalIndexPage() {
  return (
    <div className="bg-surface min-h-screen">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-16">

        <div className="mb-8 md:mb-10">
          <p className="text-accent-500 text-xs font-bold uppercase tracking-widest mb-1">Legal</p>
          <h1 className="text-3xl md:text-4xl font-extrabold text-foreground">Policies &amp; Legal</h1>
          <p className="text-foreground-secondary mt-2">Everything you need to know about how we operate, your rights, and our commitments to you.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {policies.map((policy) => (
            <Link
              key={policy.slug}
              href={`/legal/${policy.slug}`}
              className="group bg-surface-elevated rounded-xl border border-border-default p-5 hover:border-primary-400 hover:shadow-md transition-all duration-200 flex gap-4 items-start"
            >
              <div className="w-10 h-10 rounded-lg bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center shrink-0 group-hover:bg-primary-100 transition-colors">
                <svg className="w-5 h-5 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  {icons[policy.slug] ?? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />}
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="font-bold text-foreground text-sm group-hover:text-primary-600 transition-colors">{policy.title}</h2>
                <p className="text-xs text-foreground-secondary mt-0.5 leading-relaxed line-clamp-2">{policy.description}</p>
                <p className="text-xs text-foreground-muted mt-2">Updated {policy.lastUpdated}</p>
              </div>
              <svg className="w-4 h-4 text-foreground-muted group-hover:text-primary-500 transition-colors shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ))}
        </div>

        <div className="mt-10 bg-surface-elevated rounded-xl border border-border-default p-6 text-center">
          <p className="text-sm text-foreground-secondary mb-3">
            Can&apos;t find what you&apos;re looking for? Our support team can help.
          </p>
          <Link
            href="/support"
            className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-6 py-2.5 rounded-lg font-semibold text-sm transition-colors"
          >
            Contact Support
          </Link>
        </div>

      </div>
    </div>
  )
}
