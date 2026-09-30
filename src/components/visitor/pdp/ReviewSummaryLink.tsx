'use client'

import { PDP_REVIEWS_ID, scrollToId } from './pdp'
import type { ReviewSummary } from '@/lib/review-summary-types'

const STAR_PATH =
  'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z'

function StarRow({ className }: { className: string }) {
  return (
    <span className={`flex ${className}`}>
      {[0, 1, 2, 3, 4].map(i => (
        <svg key={i} className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
          <path d={STAR_PATH} />
        </svg>
      ))}
    </span>
  )
}

/** Compact approved-review rating near the product title; jumps to the reviews section. */
export default function ReviewSummaryLink({ summary, className = '' }: { summary: ReviewSummary; className?: string }) {
  if (summary.total <= 0) return null
  const noun = summary.total === 1 ? 'review' : 'reviews'
  const fill = Math.min(100, Math.max(0, (summary.average / 5) * 100))

  return (
    <div className={className}>
      <a
        href={`#${PDP_REVIEWS_ID}`}
        onClick={e => {
          e.preventDefault()
          scrollToId(PDP_REVIEWS_ID)
        }}
        aria-label={`Rated ${summary.average.toFixed(1)} out of 5 from ${summary.total} ${noun}. Go to reviews`}
        className="group inline-flex items-center gap-2 text-sm rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
      >
        <span className="relative inline-flex" aria-hidden="true">
          <StarRow className="text-gray-300 dark:text-gray-600" />
          <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${fill}%` }}>
            <StarRow className="text-yellow-400" />
          </span>
        </span>
        <span className="font-semibold text-foreground">{summary.average.toFixed(1)}</span>
        <span className="text-foreground-muted group-hover:text-accent-600 group-hover:underline underline-offset-2">
          {summary.total} {noun}
        </span>
      </a>
    </div>
  )
}
