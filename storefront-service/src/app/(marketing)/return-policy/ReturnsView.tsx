import Link from 'next/link'
import { getStoreLegalContext, getStorePolicyBySlug, policyPdfName } from '@/lib/legals/store-policies'

// The working part of an AI-designed returns page (<ReturnsContent />): how to start a return from the order, where the
// store's return and replacement rules apply, then the store's own return and refund policy with its PDF. The design
// writes the page's heading.

const STEPS = ['Open the order in My Orders', 'Choose the items to return or replace, and tell us why', 'Follow the request on the order page']

export default async function ReturnsView() {
  const [policy, { slug: storeSlug }] = await Promise.all([getStorePolicyBySlug('return-refund-policy'), getStoreLegalContext()])
  return (
    <div className="container mx-auto px-4 py-6 md:py-10">
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="ui-card bg-surface-elevated rounded-xl border border-border-default p-6">
          <h2 className="ui-heading text-base md:text-lg font-bold text-foreground">How to start a return</h2>
          <ol className="mt-4 grid gap-3 sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s} className="flex items-start gap-3">
                <span className="w-7 h-7 shrink-0 rounded-full bg-accent-500 text-white text-sm font-bold flex items-center justify-center">{i + 1}</span>
                <span className="text-sm text-foreground-secondary">{s}</span>
              </li>
            ))}
          </ol>
          <Link
            href="/account/orders"
            className="ui-btn mt-5 inline-flex items-center justify-center bg-accent-500 hover:bg-accent-600 text-white px-6 py-2.5 rounded-lg font-semibold text-sm transition-colors"
          >
            Go to my orders
          </Link>
        </div>

        {policy?.sections.map((section, i) => (
          <div key={i} className="ui-card bg-surface-elevated rounded-xl border border-border-default p-6">
            <h2 className="ui-heading text-base md:text-lg font-bold text-foreground mb-3">{section.heading}</h2>
            {Array.isArray(section.body) ? (
              <ul className="space-y-2">
                {section.body.map((item, j) => (
                  <li key={j} className="flex gap-2 text-sm text-foreground-secondary leading-relaxed">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent-500 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-foreground-secondary leading-relaxed">{section.body}</p>
            )}
          </div>
        ))}

        {policy && (
          <p className="text-xs text-foreground-muted">
            Last updated: {policy.lastUpdated} ·{' '}
            <a
              href={`/api/legal/${policy.slug}/pdf`}
              download={policyPdfName(storeSlug, policy.slug)}
              className="font-semibold text-accent-600 hover:text-accent-700 dark:text-accent-400"
            >
              Download PDF
            </a>
          </p>
        )}
      </div>
    </div>
  )
}
