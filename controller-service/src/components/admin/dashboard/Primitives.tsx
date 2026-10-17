import Link from 'next/link'
import type { ReactNode } from 'react'
import { Badge, type Tone } from '@/components/admin/kit/core'

// Legacy dashboard primitives. The dashboard itself is on the kit; these stay as thin re-exports
// and wrappers for the overview cards that still import from here (removed in phase 3).
export { rs, rsCompact, numStr, pctStr, hoursStr, daysStr, delta } from '@/components/admin/kit/format'
export { GroupLabel, MiniStat, CompactStat, ListRows, PctBadge } from '@/components/admin/kit/stats'
export { HourBars, FunnelBar, LinkedLegend, FUNNEL_STAGES } from '@/components/admin/kit/charts'

export const Icon = ({ d, cls }: { d: string; cls: string }) => (
  <svg className={`w-5 h-5 ${cls}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d={d} />
  </svg>
)

export const Chevron = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
  </svg>
)

export function SectionHeader({ title, actionLabel, href }: { title: string; actionLabel?: string; href?: string }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {actionLabel && href && (
        <Link href={href} className="inline-flex items-center gap-0.5 text-xs font-medium text-accent-600 hover:text-accent-500 transition-colors">
          {actionLabel} <Chevron />
        </Link>
      )}
    </div>
  )
}

/** With `href` the whole card navigates and must contain no inner anchors. */
export function SectionCard({ href, span, children }: { href?: string; span?: boolean; children: ReactNode }) {
  const base = `bg-surface-elevated rounded-xl border border-border-default p-4 sm:p-5 ${span ? 'lg:col-span-2' : ''}`
  if (href) {
    return (
      <Link href={href} className={`${base} block hover:border-accent-500/50 transition-colors`}>
        {children}
      </Link>
    )
  }
  return <div className={base}>{children}</div>
}

const CHIP_TONE: Record<'neutral' | 'good' | 'warn' | 'bad', Tone> = { neutral: 'muted', good: 'green', warn: 'amber', bad: 'red' }

export function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' }) {
  return <Badge tone={CHIP_TONE[tone]}>{children}</Badge>
}

export function statusBadgeClass(status: string) {
  if (status === 'delivered' || status === 'granted') return 'bg-green-500/10 text-green-700 dark:text-green-400'
  if (status === 'processing' || status === 'confirmed') return 'bg-blue-500/10 text-blue-700 dark:text-blue-400'
  if (status === 'shipped' || status === 'out_for_delivery') return 'bg-blue-500/10 text-blue-700 dark:text-blue-400'
  if (status === 'cancelled') return 'bg-red-500/10 text-red-600 dark:text-red-400'
  return 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
}

export function statusLabel(s: string) {
  if (s === 'granted') return 'Access granted'
  if (s === 'out_for_delivery') return 'Out for Delivery'
  if (s === 'cancel_requested') return 'Cancel Req.'
  return s.replace(/_/g, ' ')
}
