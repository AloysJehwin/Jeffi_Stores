'use client'

import { Suspense, useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import {
  AttentionList,
  OverviewSkeleton,
  PeriodBar,
  usePeriod,
  useOverviewData,
  type AttentionItem,
} from '@/components/admin/overview/kit'
import { Banner, KpiGrid, TabLinks as SharedTabLinks } from '@/components/admin/channels/ui'
import type { Period } from '@/lib/overview/period'
import { resolveListTab, type ListTab } from '@/lib/overviews/catalog'

// Client pieces shared by the catalogue overview tabs (products, categories, brands, offers,
// catalogue enrichment, bulk price).

export const withAp = (items: AttentionItem[] | undefined) =>
  (items ?? []).map(i => (i.href ? { ...i, href: ap(i.href) } : i))

/** Period bar + loader for `endpoint`; renders `children(data)` only for the current period.
 * `query` (a list's filters) is sent along; `filters` renders under the period bar. */
export function OverviewFrame<T extends { attention?: AttentionItem[] }>({
  endpoint,
  children,
  skeleton,
  query,
  filters,
}: {
  endpoint: string
  children: (data: T, period: Period) => React.ReactNode
  skeleton?: React.ReactNode
  query?: string
  filters?: React.ReactNode
}) {
  const [period, setPeriod] = usePeriod()
  const { data, error, loading, reload } = useOverviewData<T>(
    `${endpoint}?from=${period.from}&to=${period.to}${query ? `&${query}` : ''}`
  )
  return (
    <div className="space-y-4">
      <PeriodBar value={period} onChange={setPeriod} onRefresh={reload} busy={loading} />
      {filters}
      {error ? (
        <Banner ok={false}>{error}</Banner>
      ) : !data ? (
        (skeleton ?? <OverviewSkeleton />)
      ) : (
        children(data, period)
      )}
    </div>
  )
}

/** Overview tab body for the smaller catalogue pages: KPIs, then attention beside one panel. */
export function OverviewTab<T extends { attention?: AttentionItem[] }>({
  endpoint,
  kpis,
  extra,
  query,
  filters,
}: {
  endpoint: string
  kpis: (data: T) => React.ReactNode
  extra?: (data: T) => React.ReactNode
  query?: string
  filters?: React.ReactNode
}) {
  return (
    <Suspense fallback={<OverviewSkeleton />}>
      <OverviewFrame<T> endpoint={endpoint} query={query} filters={filters}>
        {data => (
          <div className="space-y-4">
            <KpiGrid>{kpis(data)}</KpiGrid>
            <div className={extra ? 'grid grid-cols-1 gap-4 lg:grid-cols-2' : ''}>
              <AttentionList items={withAp(data.attention)} />
              {extra?.(data)}
            </div>
          </div>
        )}
      </OverviewFrame>
    </Suspense>
  )
}

/** Active tab from the URL on client pages (see resolveListTab). */
export function useListTab(): ListTab {
  const sp = useSearchParams()
  return resolveListTab(Object.fromEntries(sp.entries()))
}

/** Overview / list switch kept in ?tab, as links so it works from server pages. */
export function TabLinks({
  base,
  active,
  tabs,
  actions,
  query,
}: {
  base: string
  active: string
  tabs: { id: string; label: string }[]
  actions?: React.ReactNode
  /** A list's filters, carried to every tab. */
  query?: string
}) {
  return (
    <div className="mb-6">
      <SharedTabLinks
        tabs={tabs.map(t => ({ ...t, href: ap(`${base}?tab=${t.id}${query ? `&${query}` : ''}`) }))}
        value={active}
        actions={actions}
        scroll={false}
      />
    </div>
  )
}

/** Small bar chart for a period series. */
export function Bars<T>({
  rows,
  value,
  label,
  format,
}: {
  rows: T[]
  value: (r: T) => number
  label: (r: T) => string
  format: (v: number) => string
}) {
  const max = Math.max(0, ...rows.map(value))
  if (!rows.length) return null
  return (
    <div>
      <div className="flex items-end gap-px h-40" role="img" aria-label="Chart">
        {rows.map((r, i) => {
          const v = value(r)
          return (
            <div key={i} className="flex-1 h-full flex items-end group relative min-w-0">
              <div
                className="w-full rounded-t bg-accent-500/80 group-hover:bg-accent-500"
                style={{ height: `${max ? Math.max(v ? 2 : 0, (v / max) * 100) : 0}%` }}
              />
              <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block whitespace-nowrap rounded bg-surface-elevated border border-border-default px-1.5 py-0.5 text-[11px] text-foreground shadow z-10">
                {label(r)}: {format(v)}
              </span>
            </div>
          )
        })}
      </div>
      <div className="flex justify-between text-[11px] text-foreground-muted mt-1">
        <span>{label(rows[0])}</span>
        <span>{label(rows[rows.length - 1])}</span>
      </div>
    </div>
  )
}

/** Remembers the list tab for the browser session, so filter links that drop ?tab (old URLs,
 * "Clear all") keep the list open until Overview is picked again. */
export function TabMemory({
  storageKey,
  tab,
  explicit,
}: {
  storageKey: string
  tab: 'overview' | 'list'
  explicit: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  useEffect(() => {
    const key = `admin-tab:${storageKey}`
    let saved: string | null = null
    try {
      saved = sessionStorage.getItem(key)
      if (tab === 'list' || explicit) sessionStorage.setItem(key, tab)
    } catch {}
    if ((tab === 'list' && !explicit) || (tab === 'overview' && !explicit && saved === 'list')) {
      const q = new URLSearchParams(sp.toString())
      q.set('tab', 'list')
      router.replace(`${pathname}?${q}`, { scroll: false })
    }
  }, [storageKey, tab, explicit, sp, router, pathname])
  return null
}
