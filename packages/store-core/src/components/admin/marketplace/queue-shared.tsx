'use client'

import { useEffect, useState } from 'react'
import { Badge, type Tone } from '@/components/admin/kit/core'

// Shared bits of the marketplace Orders / Returns / Overview tabs (client-safe: no server imports).

export type Channel = 'myntra' | 'ajio'
export const CHANNEL_NAME: Record<Channel, string> = { myntra: 'Myntra', ajio: 'AJIO' }

export const MARKET_STATUS: Record<string, { label: string; tone: Tone }> = {
  created: { label: 'New', tone: 'amber' },
  accepted: { label: 'Accepted', tone: 'blue' },
  packed: { label: 'Packed', tone: 'blue' },
  ready_to_dispatch: { label: 'Ready to dispatch', tone: 'blue' },
  shipped: { label: 'Shipped', tone: 'green' },
  delivered: { label: 'Delivered', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
  rejected: { label: 'Rejected', tone: 'red' },
  returned: { label: 'Returned', tone: 'amber' },
}

export const RETURN_STATUS: Record<string, { label: string; tone: Tone }> = {
  initiated: { label: 'Initiated', tone: 'amber' },
  in_transit: { label: 'In transit', tone: 'blue' },
  received: { label: 'Received', tone: 'blue' },
  qc_passed: { label: 'QC passed', tone: 'green' },
  qc_failed: { label: 'QC failed', tone: 'red' },
  closed: { label: 'Closed', tone: 'muted' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
}

export function StatusPill({ status, map = MARKET_STATUS }: { status: string; map?: Record<string, { label: string; tone: Tone }> }) {
  const s = map[status]
  return <Badge tone={s?.tone ?? 'muted'}>{s?.label ?? status.replace(/_/g, ' ')}</Badge>
}

/** Re-renders every `ms` so countdowns stay current. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

function span(ms: number): string {
  const mins = Math.max(1, Math.round(Math.abs(ms) / 60_000))
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  if (h < 48) return `${h}h ${mins % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

/** "3h 10m left" or "Overdue 20m" against a deadline. */
export function Countdown({ at, now }: { at: string | null; now: number }) {
  if (!at) return <span className="text-foreground-muted">-</span>
  const left = new Date(at).getTime() - now
  const late = left < 0
  const tight = !late && left < 2 * 3600_000
  return (
    <span className={`tabular-nums text-xs font-medium ${late ? 'text-red-600 dark:text-red-400' : tight ? 'text-amber-700 dark:text-amber-400' : 'text-foreground'}`} title={new Date(at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}>
      {late ? `Overdue ${span(left)}` : `${span(left)} left`}
    </span>
  )
}
