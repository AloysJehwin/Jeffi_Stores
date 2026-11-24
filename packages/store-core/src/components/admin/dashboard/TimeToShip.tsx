'use client'

import type { DashboardActivity } from '../../../lib/dashboard/activity-types'
import { acc, dec1, nf, usePrefersReducedMotion, useMounted } from './viz'

export interface TimeToShipProps {
  buckets: DashboardActivity['timeToShip']
  medianDays: number | null
  within2dPct: number | null
  className?: string
}

/** Placed-to-shipped histogram with a Median badge; the fastest-heavy bucket takes the accent. */
export function TimeToShip({ buckets, medianDays, within2dPct, className = '' }: TimeToShipProps) {
  const reduced = usePrefersReducedMotion()
  const mounted = useMounted(reduced)
  const max = Math.max(0, ...buckets.map(b => b.count))
  if (max <= 0) return <p className={`py-6 text-center text-xs text-foreground-muted ${className}`}>No shipped orders yet.</p>
  const top = buckets.findIndex(b => b.count === max)
  return (
    <div className={className}>
      <div className="mb-2 flex justify-end">
        {medianDays != null && <span className="rounded-full bg-surface-secondary px-2 py-0.5 text-[11px] font-medium tabular-nums text-foreground-secondary">Median {dec1(medianDays)}d</span>}
      </div>
      <div className="flex h-24 items-end gap-2">
        {buckets.map((b, i) => (
          <div key={b.bucket} className="flex h-full flex-1 flex-col items-center justify-end gap-1" role="img" aria-label={`${b.bucket}: ${b.count} orders`}>
            <span className="text-[10px] tabular-nums text-foreground-secondary">{nf(b.count)}</span>
            <div
              data-bar={i === top ? 'peak' : 'bucket'}
              className="w-full origin-bottom rounded-md"
              style={{
                height: `${Math.max(b.count ? 4 : 2, (b.count / max) * 72)}%`,
                background: i === top ? acc(500) : 'var(--color-border)',
                transform: mounted ? 'scaleY(1)' : 'scaleY(0)',
                transition: reduced ? undefined : `transform 450ms cubic-bezier(0.23,1,0.32,1) ${i * 40}ms`,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-2 text-center text-[10px] text-foreground-muted">
        {buckets.map(b => (
          <span key={b.bucket} className="flex-1">
            {b.bucket}
          </span>
        ))}
      </div>
      {within2dPct != null && <p className="mt-2 text-[11px] text-foreground-muted">{Math.round(within2dPct)}% ship within 2 days</p>}
    </div>
  )
}
