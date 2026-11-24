'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Download, X } from 'lucide-react'
import type { ActivityChannel, ActivityDay, DashboardActivity } from '../../../lib/dashboard/activity-types'
import { useFocusTrap, useScrollLock } from '../kit/dialog'
import { SegmentedPills } from './SegmentedPills'
import { IsoColumns } from './IsoColumns'
import { WeekdayRhythm } from './WeekdayRhythm'
import { TimeToShip } from './TimeToShip'
import { ThroughputLines } from './ThroughputLines'
import { ProductShippedTable } from './ProductShippedTable'
import { acc, CARD_SHADOW, fmtLong, fmtShort, nf, usePrefersReducedMotion } from './viz'

export interface ActivityDrawerProps {
  activity: DashboardActivity
  open: boolean
  onClose: () => void
  loading?: boolean
  storeName?: string
  /** YYYY-MM-DD of today, for the daily-average maths in the chart tooltip. */
  today?: string
  onRefetch: (next: { weeks: number; channel: ActivityChannel }) => void
}

const PERIODS = [13, 26, 52]
const CHANNELS: { value: ActivityChannel; label: string }[] = [
  { value: 'all', label: 'All channels' },
  { value: 'online', label: 'Online' },
  { value: 'cod', label: 'COD' },
  { value: 'business', label: 'Business' },
]
const MODES = [
  { value: '3d', label: '3D' },
  { value: 'grid', label: 'Grid' },
] as const

const csvCell = (v: string | number) => {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** The `days` series as CSV text (top categories as `Name:count|Name:count`). */
export function activityToCsv(days: ActivityDay[]): string {
  const rows = [['date', 'shipped', 'placed', 'customers', 'top_categories'].join(',')]
  for (const d of days) rows.push([d.date, d.shipped, d.placed, d.customers, d.top.map(t => `${t.name}:${t.count}`).join('|')].map(csvCell).join(','))
  return rows.join('\n')
}

function downloadCsv(activity: DashboardActivity) {
  const blob = new Blob([activityToCsv(activity.days)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `orders-shipped-${activity.from}_${activity.to}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function Stat({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: string; accent?: boolean }) {
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

/** Right-hand sheet (full screen on phones) with the 3D shipped-orders chart and fulfilment breakdowns. */
export function ActivityDrawer({ activity, open, onClose, loading = false, storeName, today, onRefetch }: ActivityDrawerProps) {
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const reduced = usePrefersReducedMotion()
  const [mode, setMode] = useState<'3d' | 'grid'>(() => (typeof window !== 'undefined' && window.innerWidth < 640 ? 'grid' : '3d'))
  const [weeks, setWeeks] = useState(activity.weeks)
  const [channel, setChannel] = useState<ActivityChannel>(activity.channel)
  const [entered, setEntered] = useState(false)
  useScrollLock(open)
  useFocusTrap(open, panel)

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

  if (!open || typeof document === 'undefined') return null
  const t = activity.totals
  const change = (next: { weeks?: number; channel?: ActivityChannel }) => {
    const w = next.weeks ?? weeks
    const c = next.channel ?? channel
    setWeeks(w)
    setChannel(c)
    onRefetch({ weeks: w, channel: c })
  }
  const selectCls = 'rounded-full bg-surface-secondary px-3 py-1.5 text-xs font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-accent-500'
  const iconBtn = 'inline-flex h-8 w-8 items-center justify-center rounded-lg text-foreground-muted transition-colors hover:bg-surface-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500'

  return createPortal(
    <div
      className="fixed inset-0 z-[1000]"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="absolute inset-0 bg-black/40" style={{ opacity: entered ? 1 : 0, transition: reduced ? undefined : 'opacity 280ms' }} onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-full flex-col bg-surface outline-none md:max-w-[560px] md:rounded-l-2xl md:shadow-2xl"
        style={{ transform: entered ? 'translateX(0)' : 'translateX(100%)', transition: reduced ? undefined : 'transform 280ms cubic-bezier(0.23,1,0.32,1)' }}
      >
        <header className="px-5 pb-3 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id={titleId} className="text-base font-semibold text-foreground">
                Orders shipped
              </h2>
              <p className="mt-0.5 truncate text-[11px] text-foreground-muted">
                {storeName ? `${storeName} · ` : ''}
                {fmtShort(activity.from)} – {fmtShort(activity.to)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button type="button" aria-label="Export CSV" title="Export CSV" onClick={() => downloadCsv(activity)} className={iconBtn}>
                <Download className="h-4 w-4" />
              </button>
              <button type="button" aria-label="Close" title="Close" onClick={onClose} className={iconBtn}>
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <SegmentedPills ariaLabel="Chart view" options={[...MODES]} value={mode} onChange={setMode} />
            <select aria-label="Period" value={weeks} onChange={e => change({ weeks: Number(e.target.value) })} className={selectCls}>
              {PERIODS.map(p => (
                <option key={p} value={p}>
                  Last {p} weeks
                </option>
              ))}
            </select>
            <select aria-label="Channel" value={channel} onChange={e => change({ channel: e.target.value as ActivityChannel })} className={`${selectCls} sm:ml-auto`}>
              {CHANNELS.map(c => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-6" aria-busy={loading}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4" data-stats="">
            <Stat label={`${activity.weeks}-week total`} value={nf(t.shipped)} sub="orders" accent />
            <Stat label="Busiest day" value={t.busiestDay ? nf(t.busiestDay.count) : '–'} sub={t.busiestDay ? fmtLong(t.busiestDay.date) : undefined} />
            <Stat label="Longest streak" value={t.longestStreak} sub="days" />
            <Stat label="Current streak" value={t.currentStreak} sub="days" />
          </div>
          {loading ? (
            <Skeleton />
          ) : (
            <>
              <div className={`rounded-2xl bg-surface-elevated p-3 ${CARD_SHADOW}`}>
                <IsoColumns days={activity.days} mode={mode} today={today} />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Panel title="Weekday rhythm">
                  <WeekdayRhythm weekday={activity.weekday} />
                </Panel>
                <Panel title="Time to ship">
                  <TimeToShip buckets={activity.timeToShip} medianDays={activity.medianDaysToShip} within2dPct={activity.shippedWithin2dPct} />
                </Panel>
              </div>
              <Panel title="Throughput · weekly">
                <ThroughputLines throughput={activity.throughput} backlog={activity.backlog} />
              </Panel>
              <Panel title="Top products shipped">
                <ProductShippedTable products={activity.topProducts} />
              </Panel>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
