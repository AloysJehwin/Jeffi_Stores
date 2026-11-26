'use client'

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Download, X } from 'lucide-react'
import AdminSelect from '../AdminSelect'
import { useFocusTrap, useScrollLock } from '../kit/dialog'
import { SegmentedControl } from '../kit/segmented'
import { IsoColumns, type IsoDay } from '../dashboard/IsoColumns'
import { acc, CARD_SHADOW, fmtLong, fmtShort, nf, usePrefersReducedMotion } from '../dashboard/viz'
import { dayTotal, INSIGHTS_PERIODS, insightsToCsv, type InsightsQuery, type InsightsSeries } from '@/lib/insights/series'

export interface InsightsCopy {
  /** What the chart counts: "Orders shipped" reads "Orders shipped per day over 26 weeks". */
  subject: string
  /** Word after a count: "12 shipped". */
  unit: string
  /** Noun under the period total: "orders". */
  noun: string
  /** Empty chart text. */
  empty?: string
}

export interface InsightsFilter {
  /** Accessible name of the select, e.g. "Channel". */
  label: string
  options: { value: string; label: string }[]
  /** Default: the first option. */
  initial?: string
}

export interface InsightsStat {
  label: string
  value: ReactNode
  sub?: string
  accent?: boolean
}

export interface InsightsSection<E = unknown> {
  title: string
  render: (s: InsightsSeries<E>, copy: InsightsCopy) => ReactNode
  /** Half width from sm up; two half sections in a row share a line. */
  half?: boolean
}

export interface InsightsConfig<E = unknown> {
  title: string
  copy: InsightsCopy
  /** Fetches the series for a query; null (or a throw) shows the error state. */
  load: (q: InsightsQuery) => Promise<InsightsSeries<E> | null>
  /** Week options, default 13 / 26 / 52. */
  periods?: number[]
  filter?: InsightsFilter
  /** Stat strip; default total, busiest day and streaks from `totals`. */
  stats?: (s: InsightsSeries<E>, copy: InsightsCopy) => InsightsStat[]
  sections?: InsightsSection<E>[]
  /** CSV file name prefix (default: the title as a slug); false hides Export. */
  exportName?: string | false
  toCsv?: (s: InsightsSeries<E>) => string
}

export interface InsightsDrawerProps<E = unknown> extends InsightsConfig<E> {
  open: boolean
  onClose: () => void
  /** Before the date range in the header, e.g. the store name. */
  subtitle?: string
  /** Series already in hand (server render); its weeks + filter become the first query, with no fetch. */
  initial?: InsightsSeries<E> | null
}

const MODES = [
  { value: '3d' as const, label: '3D' },
  { value: 'grid' as const, label: 'Grid' },
]

const keyOf = (weeks: number, filter: string | null) => `${weeks}|${filter ?? ''}`
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'insights'

export function defaultInsightsStats(s: InsightsSeries<unknown>, copy: InsightsCopy): InsightsStat[] {
  const t = s.totals
  return [
    { label: `${s.weeks}-week total`, value: nf(t.total), sub: copy.noun, accent: true },
    { label: 'Busiest day', value: t.busiestDay ? nf(t.busiestDay.count) : '–', sub: t.busiestDay ? fmtLong(t.busiestDay.date) : undefined },
    { label: 'Longest streak', value: t.longestStreak, sub: 'days' },
    { label: 'Current streak', value: t.currentStreak, sub: 'days' },
  ]
}

/** Series days as the 3D chart's cells; stacked series become the tooltip split unless a day has its own `top`. */
export function insightsIsoDays(s: Pick<InsightsSeries<unknown>, 'series' | 'days'>): IsoDay[] {
  const split = s.series.length > 1
  return s.days.map(d => ({
    date: d.date,
    value: dayTotal(d),
    parts:
      d.top ??
      (split
        ? s.series
            .map((x, i) => ({ name: x.label, count: d.values[i] ?? 0 }))
            .filter(p => p.count > 0)
            .sort((a, b) => b.count - a.count)
        : undefined),
    note: d.note,
  }))
}

function downloadCsv(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function Stat({ label, value, sub, accent }: InsightsStat) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] text-foreground-muted">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums leading-tight" style={accent ? { color: acc(600) } : undefined}>
        {value}
      </p>
      {sub && <p className="text-[11px] text-foreground-muted">{sub}</p>}
    </div>
  )
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={`min-w-0 rounded-2xl bg-surface-elevated p-4 ${CARD_SHADOW}`}>
      <h3 className="mb-2 text-xs font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  )
}

function Skeleton() {
  return (
    <div data-skeleton="" aria-hidden="true" className="space-y-4 animate-pulse">
      <div className="aspect-[600/340] rounded-xl bg-surface-secondary" />
      <div className="grid grid-cols-2 gap-3">
        <div className="h-36 rounded-2xl bg-surface-secondary" />
        <div className="h-36 rounded-2xl bg-surface-secondary" />
      </div>
      <div className="h-40 rounded-2xl bg-surface-secondary" />
    </div>
  )
}

/** Right-hand sheet (full screen on phones): the 3D / grid chart of a page's daily series, its stats and breakdowns. */
export function InsightsDrawer<E = unknown>({
  open,
  onClose,
  subtitle,
  initial = null,
  title,
  copy,
  load,
  periods = INSIGHTS_PERIODS,
  filter,
  stats = defaultInsightsStats,
  sections = [],
  exportName,
  toCsv = insightsToCsv,
}: InsightsDrawerProps<E>) {
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const reduced = usePrefersReducedMotion()
  const [mode, setMode] = useState<'3d' | 'grid'>(() => (typeof window !== 'undefined' && window.innerWidth < 640 ? 'grid' : '3d'))
  const [weeks, setWeeks] = useState(() => initial?.weeks ?? (periods.includes(26) ? 26 : periods[0]))
  const [filterValue, setFilterValue] = useState<string | null>(() => (filter ? initial?.filter ?? filter.initial ?? filter.options[0]?.value ?? null : null))
  const [data, setData] = useState<{ key: string; series: InsightsSeries<E> } | null>(() => (initial ? { key: keyOf(initial.weeks, filterValue), series: initial } : null))
  const [failed, setFailed] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [entered, setEntered] = useState(false)
  const [mounted, setMounted] = useState(open)
  const loadRef = useRef(load)
  useScrollLock(open)
  useFocusTrap(open, panel)

  const key = keyOf(weeks, filterValue)
  const stale = open && data?.key !== key
  useEffect(() => {
    loadRef.current = load
  })
  useEffect(() => {
    if (!stale) return
    let live = true
    setFailed(null)
    Promise.resolve()
      .then(() => loadRef.current({ weeks, filter: filterValue }))
      .then(
        s => {
          if (!live) return
          if (s) setData({ key, series: s })
          else setFailed(key)
        },
        () => live && setFailed(key)
      )
    return () => {
      live = false
    }
  }, [stale, key, weeks, filterValue, attempt])

  useEffect(() => {
    if (open) setMounted(true)
    else if (reduced) setMounted(false)
    else {
      const id = setTimeout(() => setMounted(false), 200)
      return () => clearTimeout(id)
    }
  }, [open, reduced])
  useEffect(() => {
    if (!open) {
      setEntered(false)
      return
    }
    if (reduced) {
      setEntered(true)
      return
    }
    const id = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(id)
  }, [open, reduced])
  useEffect(() => {
    if (open && typeof window !== 'undefined') setMode(window.innerWidth < 640 ? 'grid' : '3d')
  }, [open])

  const series = data?.series ?? null
  const isoDays = useMemo(() => (series ? insightsIsoDays(series) : []), [series])
  if ((!open && !mounted) || typeof document === 'undefined') return null

  const error = failed === key
  const loading = stale && !error
  const rows: InsightsSection<E>[][] = []
  for (const s of sections) {
    const last = rows[rows.length - 1]
    if (s.half && last?.length === 1 && last[0].half) last.push(s)
    else rows.push([s])
  }
  const iconBtn = 'inline-flex h-8 w-8 items-center justify-center rounded-lg text-foreground-muted transition-colors hover:bg-surface-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 disabled:pointer-events-none disabled:opacity-40'
  const weekOptions = periods.includes(weeks) ? periods : [...periods, weeks].sort((a, b) => a - b)
  const range = series ? `${fmtShort(series.from)} – ${fmtShort(series.to)}` : `Last ${weeks} weeks`

  return createPortal(
    <div
      className="fixed inset-0 z-[1000]"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={e => {
        if (e.key !== 'Escape') return
        e.stopPropagation()
        // An open select closes itself first.
        if ((e.target as HTMLElement).getAttribute?.('aria-expanded') !== 'true') onClose()
      }}
    >
      <div className="absolute inset-0 bg-black/40" style={{ opacity: entered ? 1 : 0, transition: reduced ? undefined : `opacity ${entered ? 280 : 200}ms` }} onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-full flex-col bg-surface outline-none md:max-w-[560px] md:rounded-l-2xl md:shadow-2xl"
        style={{ transform: entered ? 'translateX(0)' : 'translateX(100%)', transition: reduced ? undefined : `transform ${entered ? '280ms cubic-bezier(0.23,1,0.32,1)' : '200ms ease-in'}` }}
      >
        <header className="px-5 pb-3 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id={titleId} className="text-base font-semibold text-foreground">
                {title}
              </h2>
              <p className="mt-0.5 truncate text-[11px] text-foreground-muted">
                {subtitle ? `${subtitle} · ` : ''}
                {range}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {exportName !== false && (
                <button type="button" aria-label="Export CSV" title="Export CSV" disabled={!series} onClick={() => series && downloadCsv(toCsv(series), `${exportName || slug(title)}-${series.from}_${series.to}.csv`)} className={iconBtn}>
                  <Download className="h-4 w-4" />
                </button>
              )}
              <button type="button" aria-label="Close" title="Close" onClick={onClose} className={iconBtn}>
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <SegmentedControl ariaLabel="Chart view" options={MODES} value={mode} onChange={setMode} />
            <AdminSelect sm ariaLabel="Period" className="w-36" value={String(weeks)} options={weekOptions.map(p => ({ value: String(p), label: `Last ${p} weeks` }))} onChange={v => setWeeks(Number(v))} />
            {filter && <AdminSelect sm ariaLabel={filter.label} className="w-36 sm:ml-auto" value={filterValue ?? ''} options={filter.options} onChange={setFilterValue} />}
          </div>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]" aria-busy={loading}>
          {error ? (
            <div role="alert" className={`rounded-2xl bg-surface-elevated px-4 py-10 text-center ${CARD_SHADOW}`}>
              <p className="text-sm text-foreground">Insights are unavailable right now.</p>
              <button type="button" onClick={() => setAttempt(n => n + 1)} className="control-sm mt-3 border border-border-default bg-surface-elevated text-foreground hover:bg-surface-secondary">
                Try again
              </button>
            </div>
          ) : (
            <>
              {series && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4" data-stats="">
                  {stats(series, copy).map(s => (
                    <Stat key={s.label} {...s} />
                  ))}
                </div>
              )}
              {loading || !series ? (
                <Skeleton />
              ) : (
                <>
                  <div className={`rounded-2xl bg-surface-elevated p-3 ${CARD_SHADOW}`}>
                    <IsoColumns days={isoDays} mode={mode} today={series.today} subject={copy.subject} unit={copy.unit} emptyText={copy.empty ?? 'Nothing in this range.'} />
                  </div>
                  {rows.map(row =>
                    row.length === 2 ? (
                      <div key={row[0].title} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        {row.map(s => (
                          <Panel key={s.title} title={s.title}>
                            {s.render(series, copy)}
                          </Panel>
                        ))}
                      </div>
                    ) : (
                      <Panel key={row[0].title} title={row[0].title}>
                        {row[0].render(series, copy)}
                      </Panel>
                    )
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
