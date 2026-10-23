'use client'

import { useCallback, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Kpi, Banner, count, money, pct } from '@/components/admin/channels/ui'
import {
  AttentionList,
  PeriodBar,
  useOverviewData,
  usePeriod,
  type AttentionItem,
} from '@/components/admin/overview/kit'
import { delta, parsePeriod, type PeriodPreset } from '@/lib/overview/period'
import { ap } from '@/lib/shared/admin-path'
import type { StripKpi } from '@/lib/overviews/orders'

// Shared by the orders and fulfilment overviews (Orders, Delhivery, Returns, Replacements,
// Packing slips, Labels, Scan).

/** `?tab=` (or `opts.param`) with a fallback or a legacy-URL guess; switching keeps the other params. */
export function useTab<T extends string>(
  ids: readonly T[],
  fallback: T,
  opts?: { param?: string; legacy?: (sp: URLSearchParams) => T | null }
) {
  const param = opts?.param ?? 'tab'
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const raw = sp.get(param) as T | null
  const tab: T = raw && ids.includes(raw) ? raw : (opts?.legacy?.(new URLSearchParams(sp.toString())) ?? fallback)
  const set = useCallback(
    (t: T) => {
      const q = new URLSearchParams(sp.toString())
      q.set(param, t)
      router.replace(`${pathname}?${q}`, { scroll: false })
    },
    [sp, router, pathname, param]
  )
  return [tab, set] as const
}

export const fmtHours = (h: number | null | undefined) =>
  h == null || !Number.isFinite(h) ? '-' : h >= 48 ? `${(h / 24).toFixed(1)} days` : `${h.toFixed(1)} h`
export const fmtDays = (d: number | null | undefined) =>
  d == null || !Number.isFinite(d) ? '-' : `${d.toFixed(1)} days`

/** Admin-host aware hrefs for the attention list. */
export const withAp = (items: AttentionItem[]) => items.map(i => (i.href ? { ...i, href: ap(i.href) } : i))

export function fmtStrip(k: Pick<StripKpi, 'format'>, v: number | null) {
  switch (k.format) {
    case 'money':
      return money(v)
    case 'pct':
      return pct(v)
    case 'hours':
      return fmtHours(v)
    case 'days':
      return fmtDays(v)
    default:
      return count(v)
  }
}

interface StripData {
  kpis: StripKpi[]
  attention: AttentionItem[]
}

/** Overview tab for work-queue pages: period bar, KPIs and the needs-attention list. `local` keeps
 * the period in component state for pages whose own ?from&to mean something else. */
export function OverviewPanel<T extends StripData>({
  endpoint,
  extra,
  local,
  fallback = '30d',
}: {
  endpoint: string
  extra?: (d: T) => React.ReactNode
  local?: boolean
  fallback?: PeriodPreset
}) {
  const [urlPeriod, setUrlPeriod] = usePeriod(fallback)
  const [localPeriod, setLocalPeriod] = useState(() => parsePeriod(null, null, undefined, fallback))
  const [period, setPeriod] = local ? [localPeriod, setLocalPeriod] : [urlPeriod, setUrlPeriod]
  const { data, error, loading, reload } = useOverviewData<T>(`${endpoint}?from=${period.from}&to=${period.to}`)
  return (
    <div className="space-y-4">
      <PeriodBar value={period} onChange={setPeriod} onRefresh={reload} busy={loading} />
      {error && <Banner ok={false}>{error}</Banner>}
      {loading && !data ? (
        <div className="grid grid-cols-2 [&>*:last-child:nth-child(odd)]:col-span-2 sm:[&>*:last-child:nth-child(odd)]:col-span-1 md:grid-cols-3 xl:grid-cols-5 gap-3 animate-pulse">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-surface-elevated border border-border-default" />
          ))}
        </div>
      ) : data ? (
        <>
          <div className="grid gap-3 grid-cols-2 [&>*:last-child:nth-child(odd)]:col-span-2 sm:[&>*:last-child:nth-child(odd)]:col-span-1 md:grid-cols-3 xl:grid-cols-5">
            {data.kpis.map(k => (
              <Kpi
                key={k.key}
                label={k.label}
                value={fmtStrip(k, k.value)}
                delta={k.previous == null ? null : delta(k.value, k.previous)}
                invert={k.invert}
                sub={k.sub}
              />
            ))}
          </div>
          <div className={`grid grid-cols-1 gap-3 ${extra ? 'lg:grid-cols-2' : ''}`}>
            <AttentionList items={withAp(data.attention)} />
            {extra?.(data)}
          </div>
        </>
      ) : null}
    </div>
  )
}

/** Labelled bars for a small breakdown (reasons, channels). */
export function BreakdownBars({
  rows,
  format = count,
}: {
  rows: { label: string; value: number; sub?: string }[]
  format?: (v: number) => string
}) {
  if (!rows.length) return <p className="text-sm text-foreground-muted py-4 text-center">Nothing in this period.</p>
  const max = Math.max(1, ...rows.map(r => r.value))
  return (
    <ul className="space-y-2.5">
      {rows.map(r => (
        <li key={r.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-foreground truncate">{r.label}</span>
            <span className="tabular-nums text-foreground shrink-0">
              {format(r.value)}
              {r.sub && <span className="ml-1.5 text-xs text-foreground-muted">{r.sub}</span>}
            </span>
          </div>
          <div className="mt-1 h-1.5 bg-surface-secondary rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-accent-500"
              style={{ width: `${Math.max(2, Math.round((r.value / max) * 100))}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}
