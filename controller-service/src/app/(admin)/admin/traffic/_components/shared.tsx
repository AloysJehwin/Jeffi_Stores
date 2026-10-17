'use client'

import { change, pct } from '@/components/admin/channels/ui'
import type { AttentionItem } from '@/components/admin/overview/kit'
import { ap } from '@/lib/shared/admin-path'
import type { Attention } from '@/lib/traffic/types'

export const ratio = (a: number, b: number) => (b > 0 ? a / b : null)

/** Small "+12.0%" next to a value, green when the move is good. */
export function Change({ cur, prev, invert }: { cur: number; prev: number; invert?: boolean }) {
  const d = change(cur, prev)
  if (d == null) return <span className="text-[11px] text-foreground-muted">new</span>
  const good = invert ? d < 0 : d > 0
  return (
    <span className={`text-[11px] tabular-nums ${d === 0 ? 'text-foreground-muted' : good ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
      {d > 0 ? '+' : ''}
      {(d * 100).toFixed(1)}%
    </span>
  )
}

/** Change in percentage points between two rates. */
export function PointChange({ cur, prev, invert }: { cur: number | null; prev: number | null; invert?: boolean }) {
  if (cur == null || prev == null) return null
  const d = (cur - prev) * 100
  const good = invert ? d < 0 : d > 0
  return (
    <span className={`text-[11px] tabular-nums ${Math.abs(d) < 0.05 ? 'text-foreground-muted' : good ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
      {d > 0 ? '+' : ''}
      {d.toFixed(1)} pts
    </span>
  )
}

export const rateText = (a: number, b: number, d = 1) => pct(ratio(a, b), d)

export function bucketLabel(bucket: string, kind: 'day' | 'week') {
  const s = new Date(`${bucket}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  return kind === 'week' ? `wk ${s}` : s
}

export const toAttention = (items: Attention[]): AttentionItem[] => items.map(i => ({ ...i, href: i.href ? ap(i.href) : undefined }))

export const productHref = (id: string) => ap(`/admin/products/${id}`)

export function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-foreground-muted">{children}</p>
}
