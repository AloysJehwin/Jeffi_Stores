'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, AlertCircle, Info, CheckCircle2, RefreshCw } from 'lucide-react'
import { PERIOD_PRESETS, matchPreset, parsePeriod, previousPeriod, type Period, type PeriodPreset } from '@/lib/overview/period'
import { api } from '@/components/admin/channels/ui'
import DatePicker from '@/components/ui/DatePicker'

// Shared pieces for admin overview tabs: the period bar (presets + custom, kept in ?from&to), a
// loader that only ever returns data fetched for the current URL, and the needs-attention list.

/** The period from ?from&to (default 30 days) and a setter that keeps other query params. */
export function usePeriod(fallback: PeriodPreset = '30d'): [Period, (p: Period) => void] {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const period = parsePeriod(sp.get('from'), sp.get('to'), undefined, fallback)
  const set = useCallback(
    (p: Period) => {
      const q = new URLSearchParams(sp.toString())
      q.set('from', p.from)
      q.set('to', p.to)
      router.replace(`${pathname}?${q}`, { scroll: false })
    },
    [sp, router, pathname]
  )
  return [period, set]
}

export function PeriodBar({ value, onChange, onRefresh, busy }: { value: Period; onChange: (p: Period) => void; onRefresh?: () => void; busy?: boolean }) {
  const active = matchPreset(value)
  const prev = previousPeriod(value)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex h-control max-w-full overflow-x-auto gap-0.5 p-0.5 bg-surface-elevated border border-border-default rounded-lg">
        {PERIOD_PRESETS.map(p => (
          <button
            key={p.id}
            type="button"
            onClick={() => onChange(parsePeriod(null, null, undefined, p.id))}
            className={`flex items-center px-2.5 text-xs font-medium rounded-md whitespace-nowrap ${active === p.id ? 'bg-accent-500 text-white' : 'text-foreground-muted hover:text-foreground'}`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1 text-xs">
<DatePicker aria-label="From" value={value.from} max={value.to} onChange={v => v && onChange({ from: v, to: value.to })} />
        <span className="text-foreground-muted">to</span>
<DatePicker aria-label="To" value={value.to} min={value.from} onChange={v => v && onChange({ from: value.from, to: v })} />
      </div>
      <span className="text-xs text-foreground-muted">vs {prev.from} to {prev.to}</span>
      {onRefresh && (
        <button type="button" onClick={onRefresh} aria-label="Refresh" className="ml-auto control-md control-icon text-foreground-muted hover:text-foreground hover:bg-surface-elevated">
          <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
        </button>
      )}
    </div>
  )
}

/** GET `url` and keep the result tagged with the url it came from, so a slow response for an old
 * period or tab is never shown under a new one. */
export function useOverviewData<T = any>(url: string | null): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [state, setState] = useState<{ url: string; data?: T; error?: string } | null>(null)
  const [key, setKey] = useState(0)
  useEffect(() => {
    if (!url) return
    let live = true
    api<T>(url).then(r => {
      if (!live) return
      setState(r.ok ? { url, data: r.data } : { url, error: (r.data as any)?.error || 'Failed to load' })
    })
    return () => {
      live = false
    }
  }, [url, key])
  const mine = state && state.url === url ? state : null
  return { data: (mine?.data as T) ?? null, error: mine?.error ?? null, loading: !!url && !mine, reload: () => setKey(k => k + 1) }
}

export interface AttentionItem {
  key: string
  severity: 'critical' | 'warning' | 'info'
  title: string
  sub?: string
  href?: string
}

const SEV = {
  critical: { Icon: AlertCircle, cls: 'text-red-500' },
  warning: { Icon: AlertTriangle, cls: 'text-amber-500' },
  info: { Icon: Info, cls: 'text-blue-500' },
}

export function AttentionList({ items, title = 'Needs attention', empty = 'Nothing needs attention right now.' }: { items: AttentionItem[]; title?: string; empty?: string }) {
  return (
    <div className="bg-surface-elevated border border-border-default rounded-xl p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted mb-3">{title}</h3>
      {items.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
          <CheckCircle2 className="w-4 h-4" />
          {empty}
        </p>
      ) : (
        <ul className="divide-y divide-border-default">
          {items.map(it => {
            const { Icon, cls } = SEV[it.severity]
            const body = (
              <div className="flex items-start gap-2 py-2">
                <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${cls}`} />
                <div className="min-w-0">
                  <p className="text-sm text-foreground">{it.title}</p>
                  {it.sub && <p className="text-xs text-foreground-muted">{it.sub}</p>}
                </div>
              </div>
            )
            return <li key={it.key}>{it.href ? <Link href={it.href} className="block hover:bg-surface-secondary rounded-md px-1 -mx-1">{body}</Link> : body}</li>
          })}
        </ul>
      )}
    </div>
  )
}

/** Overview body skeleton while loading. */
export function OverviewSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-surface-elevated border border-border-default" />
        ))}
      </div>
      <div className="h-64 rounded-xl bg-surface-elevated border border-border-default" />
    </div>
  )
}
