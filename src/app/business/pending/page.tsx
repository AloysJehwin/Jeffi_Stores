'use client'

import Link from 'next/link'

function bp(path: string) {
  if (typeof window !== 'undefined' && window.location.hostname.startsWith('business.')) {
    return path.replace(/^\/business/, '') || '/'
  }
  return path
}

export default function BusinessPendingPage() {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4 py-12">
      <div className="max-w-lg w-full text-center">
        <div className="w-20 h-20 bg-yellow-100 dark:bg-yellow-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-10 h-10 text-yellow-600 dark:text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-foreground mb-3">Application Under Review</h1>
        <p className="text-foreground-secondary leading-relaxed mb-6">
          Thank you for applying to the Jeffi Stores Business Partner program.
          Our team is reviewing your application and will get back to you within <strong>24–48 hours</strong>.
        </p>

        <div className="bg-surface-elevated rounded-lg border border-border-default p-5 mb-8 text-left">
          <h2 className="text-sm font-semibold text-foreground mb-3">What happens next?</h2>
          <ol className="space-y-3">
            {[
              'Our team reviews your business details and GST number.',
              'Once approved, you\'ll receive an email notification.',
              'Sign back in to access exclusive business pricing and quote tools.',
            ].map((item, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-foreground-secondary">
                <span className="w-5 h-5 rounded-full bg-accent-100 dark:bg-accent-900/40 text-accent-700 dark:text-accent-300 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                  {i + 1}
                </span>
                {item}
              </li>
            ))}
          </ol>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/"
            className="px-6 py-3 bg-accent-500 text-white font-semibold rounded-lg hover:bg-accent-600 transition-colors text-sm"
          >
            Browse Products
          </Link>
          <Link
            href={bp('/business/signin')}
            className="px-6 py-3 border border-border-default text-foreground-secondary rounded-lg hover:bg-surface-secondary transition-colors text-sm font-medium"
          >
            Sign In Again
          </Link>
        </div>
      </div>
    </div>
  )
}
