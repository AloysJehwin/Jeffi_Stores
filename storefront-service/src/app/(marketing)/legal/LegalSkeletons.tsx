import { Sk } from '@/components/admin/kit/skeleton'
import SubscriptionsTerms from './SubscriptionsTerms'

// Loading screens for /legal and /legal/[slug] (also /return-policy, which redirects to a policy).

function DownloadIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
    </svg>
  )
}

function ContactSupport({ text, className }: { text: string; className: string }) {
  return (
    <div className="bg-surface-elevated rounded-xl border border-border-default p-6 text-center">
      <p className={className}>{text}</p>
      <span className="inline-flex items-center gap-2 bg-primary-500 text-white px-6 py-2.5 rounded-lg font-semibold text-sm">
        Contact Support
      </span>
    </div>
  )
}

export function LegalIndexSkeleton() {
  return (
    <div className="bg-surface min-h-screen" role="status" aria-busy="true" aria-label="Loading policies">
      <div className="bg-surface-elevated border-b border-border-default">
        <div className="container mx-auto px-4 py-4 sm:py-6 lg:py-8">
          <h1 className="text-3xl md:text-4xl font-bold text-secondary-500 dark:text-foreground mb-2">Policies &amp; Legal</h1>
          <p className="text-foreground-secondary text-sm">
            Everything you need to know about how we operate, your rights, and our commitments to you.
          </p>
        </div>
      </div>
      <div className="container mx-auto px-4 py-8 md:py-12">
        <div className="max-w-6xl mx-auto space-y-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="bg-surface-elevated rounded-xl border border-border-default flex gap-3 items-start">
                <div className="flex-1 flex gap-4 items-start p-5 min-w-0">
                  <div className="w-10 h-10 rounded-lg bg-primary-50 dark:bg-primary-900/20 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <Sk className="h-4 w-2/3" />
                    <Sk className="h-3 w-full mt-1.5" />
                    <Sk className="h-3 w-4/5 mt-1" />
                    <p className="flex items-center gap-1 text-xs text-foreground-muted mt-2">
                      Updated <Sk className="inline-block h-3 w-16" />
                    </p>
                  </div>
                </div>
                <div className="shrink-0 self-stretch flex items-center justify-center px-3 border-l border-border-default text-foreground-muted rounded-r-xl">
                  <DownloadIcon />
                </div>
              </div>
            ))}
          </div>
          <SubscriptionsTerms />
          <ContactSupport
            text="Can't find what you're looking for? Our support team can help."
            className="text-sm text-foreground-secondary mb-3"
          />
        </div>
      </div>
    </div>
  )
}

export function LegalDocSkeleton() {
  return (
    <div className="bg-surface min-h-screen" role="status" aria-busy="true" aria-label="Loading policy">
      <div className="bg-surface-elevated border-b border-border-default">
        <div className="container mx-auto px-4 py-4 sm:py-6 lg:py-8">
          <span className="text-xs text-accent-500 font-semibold inline-flex items-center gap-1 mb-3">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Legal &amp; Policies
          </span>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex-1">
              <Sk className="h-9 md:h-10 w-72 max-w-full mb-2" />
              <Sk className="h-4 w-96 max-w-full" />
              <p className="flex items-center gap-1 text-foreground-muted text-xs mt-1">
                Last updated: <Sk className="inline-block h-3 w-20" />
              </p>
            </div>
            <span className="shrink-0 inline-flex items-center gap-2 bg-primary-500 text-white px-4 py-2 rounded-lg font-semibold text-sm">
              <DownloadIcon />
              Download PDF
            </span>
          </div>
        </div>
      </div>
      <div className="container mx-auto px-4 py-8 md:py-12">
        <div className="max-w-6xl mx-auto space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-surface-elevated rounded-xl border border-border-default p-6">
              <Sk className="h-5 md:h-6 w-48 mb-3" />
              <div className="space-y-2">
                <Sk className="h-4 w-full" />
                <Sk className="h-4 w-11/12" />
                <Sk className="h-4 w-3/4" />
              </div>
            </div>
          ))}
          <ContactSupport text="Have questions about our policies?" className="text-xs text-foreground-muted mb-3" />
        </div>
      </div>
    </div>
  )
}
