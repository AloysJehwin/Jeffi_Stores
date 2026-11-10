import type { ReactNode } from 'react'
import { Sk } from '@/components/admin/kit/skeleton'
import { BusinessAccountNavBar } from '@/components/business/AccountSidebar'
import BusinessAccountMobileHeader from '@/components/business/AccountMobileHeader'

// The quotes pages sit outside the account layout and render its nav bar and mobile header themselves.
const CARD = 'bg-surface-elevated border border-border-default rounded-xl'
const STATUS_STEPS = ['Pending Review', 'Under Review', 'Negotiating', 'Offer Accepted', 'Quotation Ready']

function Frame({ label, className, children }: { label: string; className: string; children: ReactNode }) {
  return (
    <div className="bg-surface min-h-screen" role="status" aria-busy="true" aria-label={label}>
      <BusinessAccountNavBar />
      <BusinessAccountMobileHeader />
      <div className={`container mx-auto px-4 ${className}`}>{children}</div>
    </div>
  )
}

export function QuoteCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="min-w-0 space-y-1.5">
              <Sk className="h-4 w-36" />
              <Sk className="h-5 w-24 rounded-full" />
            </div>
            <div className="text-right flex-shrink-0 space-y-1">
              <Sk className="h-3 w-20 ml-auto" />
              <Sk className="h-5 w-16 ml-auto" />
            </div>
          </div>
          <Sk className="h-4 w-40 mb-1.5" />
          <Sk className="h-3 w-48 mb-3" />
          <div className="flex flex-col sm:flex-row gap-2">
            <span className="inline-flex items-center justify-center px-3 py-2 rounded-lg border border-border-default text-foreground-secondary text-xs font-medium">
              View Details →
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

export function QuotesListSkeleton() {
  return (
    <Frame label="Loading quotes" className="pt-4 pb-8">
      <div className="flex items-center gap-1.5 flex-wrap mb-4">
        {['All', 'Pending', 'Reviewed', 'Negotiating', 'Converted', 'Rejected'].map((s, i) => (
          <span
            key={s}
            className={`px-3 py-1 rounded-full text-xs font-medium ${i === 0 ? 'bg-accent-500 text-white' : 'bg-surface-elevated border border-border-default text-foreground-secondary'}`}
          >
            {s}
          </span>
        ))}
      </div>
      <QuoteCardsSkeleton />
    </Frame>
  )
}

export function QuoteDetailSkeleton() {
  return (
    <Frame label="Loading quote" className="py-6 pb-32">
      <div className="flex items-center gap-2 text-sm text-foreground-secondary mb-5">
        <span className="text-accent-500">My Quotes</span>
        <span>/</span>
        <Sk className="h-4 w-28" />
      </div>

      <div className="bg-zinc-800 rounded-2xl p-5 text-white border border-zinc-700 mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <span aria-hidden className="sk block rounded bg-zinc-700 h-7 w-40" />
          <span aria-hidden className="sk block rounded-full bg-zinc-700 h-5 w-24" />
        </div>
        <p className="flex items-center gap-1 text-zinc-400 text-xs mt-1">
          Submitted <span aria-hidden className="sk inline-block rounded bg-zinc-700 h-3 w-20" />
        </p>
      </div>

      <div className="lg:grid lg:grid-cols-3 lg:gap-6 space-y-5 lg:space-y-0">
        <div className="lg:col-span-2 space-y-5">
          <div className={`${CARD} overflow-hidden`}>
            <div className="px-5 py-4 border-b border-border-default">
              <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">Requested Items</h2>
            </div>
            <div className="divide-y divide-border-default">
              {[0, 1, 2].map(i => (
                <div key={i} className="p-4 space-y-2">
                  <Sk className="h-4 w-3/5" />
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[0, 1, 2, 3].map(j => (
                      <Sk key={j} className="h-10 w-full" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className={`${CARD} overflow-hidden`}>
            <div className="px-5 py-4 border-b border-border-default">
              <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">Messages</h2>
            </div>
            <div className="p-4 space-y-3">
              <Sk className="h-14 w-3/4" />
              <Sk className="h-14 w-2/3 ml-auto" />
            </div>
          </div>
        </div>

        <div className="lg:col-span-1 space-y-4">
          <div className={`${CARD} p-5`}>
            <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-4">Status</h2>
            <ol className="relative border-l border-border-default space-y-4 ml-2">
              {STATUS_STEPS.map(s => (
                <li key={s} className="ml-4">
                  <span className="absolute -left-1.5 w-3 h-3 rounded-full border-2 border-border-secondary bg-surface" />
                  <p className="text-xs font-medium text-foreground-muted">{s}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </Frame>
  )
}
