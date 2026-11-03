'use client'

import Link from 'next/link'
import { businessSectionPublic, sectionCopyDefaults } from '@/lib/catalog/homepage-sections'
import { formatDate, humanizeLabel } from '@/lib/shared/format'
import { useBusinessHome } from './BusinessHomeProvider'
import { SkeletonBlocks } from './parts'
import type { BusinessSection } from './business-home'

const COPY = sectionCopyDefaults('business_quotes')

// Same pills as the quotes page.
const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  reviewed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  negotiating: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  offer_accepted: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
}

/** Request-a-quote card, and the business's open quotes beside it once signed in. */
export default function BusinessQuotes({ section }: { section: BusinessSection }) {
  const { status, data, href } = useBusinessHome()
  const pub = businessSectionPublic(section)
  if (!pub) return null
  const member = status !== 'visitor'
  const items = (data?.quotes?.items ?? []).slice(0, pub.limit)
  const showList = status === 'loading' || items.length > 0

  return (
    <section className="py-12 md:py-16 bg-surface">
      <div className="container mx-auto px-4">
        <div className={`grid gap-5 ${showList ? 'lg:grid-cols-5' : ''}`}>
          <div
            className={`relative rounded-2xl overflow-hidden shadow-2xl p-6 sm:p-10 ${showList ? 'lg:col-span-2' : ''}`}
            style={{ background: '#0d0d0d' }}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-accent-500/20 via-transparent to-transparent" />
            <div className="relative z-10 space-y-4">
              <span className="inline-flex items-center gap-2 bg-accent-500/20 border border-accent-500/40 text-accent-400 text-[10px] font-black uppercase tracking-[0.18em] px-3 py-1.5 rounded-full w-fit">
                {section.eyebrow ?? COPY.eyebrow}
              </span>
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-black text-white leading-tight text-balance">
                {section.title ?? COPY.title}
              </h2>
              <p className="text-white/60 text-xs sm:text-sm leading-relaxed max-w-md">
                {section.subtitle ?? COPY.subtitle}
              </p>
              <Link
                href={href(member ? '/business/quotes/new' : '/business/signin')}
                className="inline-flex items-center gap-2 bg-accent-500 hover:bg-accent-400 text-white font-black text-xs sm:text-sm px-5 py-2.5 rounded-xl transition-all shadow-lg shadow-accent-500/25"
              >
                {section.cta_label ?? COPY.ctaLabel}
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          </div>

          {showList && (
            <div className="lg:col-span-3 bg-surface-elevated rounded-2xl border border-border-default p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3 mb-4">
                <h3 className="text-lg font-bold text-foreground">
                  Open quotes
                  {data?.quotes && (
                    <span className="ml-2 text-sm font-semibold text-foreground-muted">{data.quotes.open}</span>
                  )}
                </h3>
                <Link
                  href={href('/business/quotes')}
                  className="text-sm text-accent-500 hover:text-accent-400 font-semibold whitespace-nowrap transition-colors"
                >
                  View all quotes
                </Link>
              </div>
              <div className="space-y-2">
                {status === 'loading' ? (
                  <SkeletonBlocks count={Math.min(pub.limit, 3)} className="h-16" />
                ) : (
                  items.map(q => (
                    <Link
                      key={q.id}
                      href={href(`/business/quotes/${q.id}`)}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border-default px-4 py-3 hover:border-accent-500 transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground truncate">{q.rfqNumber}</p>
                        <p className="text-xs text-foreground-muted">
                          {q.itemCount} {q.itemCount === 1 ? 'item' : 'items'} · {formatDate(q.createdAt)}
                        </p>
                      </div>
                      <span
                        className={`px-2 py-0.5 text-xs font-semibold rounded-full shrink-0 ${STATUS_STYLES[q.status] || STATUS_STYLES.pending}`}
                      >
                        {humanizeLabel(q.status)}
                      </span>
                    </Link>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
