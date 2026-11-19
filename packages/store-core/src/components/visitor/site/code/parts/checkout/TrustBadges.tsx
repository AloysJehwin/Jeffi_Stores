import type { CSSProperties } from 'react'

// Reassurance badges for the checkout (and cart): the built-in four by default, or the design's own. Static markup.

export const TRUST_ICONS = {
  lock: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z',
  returns: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
  shield:
    'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  phone:
    'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z',
  truck: 'M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0',
  star: 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z',
  gift: 'M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7',
  cash: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z',
} as const
export type TrustIcon = keyof typeof TRUST_ICONS

export interface TrustBadge {
  icon: TrustIcon
  title: string
  text?: string
}

export const DEFAULT_TRUST_BADGES: TrustBadge[] = [
  { icon: 'lock', title: 'Secure Checkout', text: '256-bit SSL encryption' },
  { icon: 'returns', title: 'Easy Returns', text: '7-day return policy' },
  { icon: 'shield', title: 'Genuine Products', text: '100% authentic items' },
  { icon: 'phone', title: '24×7 Support', text: 'Always here to help' },
]

/** Up to `n` columns of at least 10rem: in a narrow column (a cart summary) the badges stack instead of squeezing. */
export const badgeColumns = (n: number): CSSProperties => {
  const cols = Math.min(Math.max(Math.round(n) || 2, 1), 4)
  return { gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, max(10rem, calc((100% - ${cols - 1} * 0.75rem) / ${cols}))), 1fr))` }
}

export default function TrustBadges({ items = DEFAULT_TRUST_BADGES, columns = 2, className }: { items?: TrustBadge[]; columns?: number; className?: string }) {
  if (!items.length) return null
  return (
    <div className={className}>
      <div className="grid gap-3" style={badgeColumns(columns)}>
        {items.map((b, i) => (
          <div key={`${b.title}:${i}`} className="flex items-center gap-3">
            <svg aria-hidden="true" className="w-8 h-8 text-accent-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={TRUST_ICONS[b.icon] ?? TRUST_ICONS.shield} />
            </svg>
            <div>
              <p className="text-xs font-semibold text-foreground">{b.title}</p>
              {b.text && <p className="text-xs text-foreground-muted">{b.text}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
