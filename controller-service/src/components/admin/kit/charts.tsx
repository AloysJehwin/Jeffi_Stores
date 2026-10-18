'use client'

// Chart cards for every admin page (promoted from financial/_components/OverviewCharts.tsx).
// Trend lines own their empty state, hover tooltip and IST bucket labels.

import { useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { numStr, rsCompact } from './format'

export type OutflowSegment = { label: string; value: number; color: string }
export type RankedItem = { name: string; value: number; sub?: string }
export type Granularity = 'day' | 'week' | 'month'
export type TrendPoint = { label: string } & Record<string, number | string>

function bucketLabel(iso: string, g: Granularity, full = false): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`)
  if (isNaN(d.getTime())) return iso
  if (g === 'month') return d.toLocaleDateString('en-IN', { month: 'short', year: full ? 'numeric' : '2-digit' })
  const day = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: full ? 'numeric' : undefined })
  return g === 'week' && full ? `Week of ${day}` : day
}

export function ChartCard({ title, hint, children, action }: { title: string; hint?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="bg-surface-elevated rounded-xl border border-border-default p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <span className="flex items-center gap-2">
          {hint && <span className="text-xs text-foreground-muted">{hint}</span>}
          {action}
        </span>
      </div>
      {children}
    </div>
  )
}

const VIEW_W = 560
const VIEW_H = 150
const PAD = { top: 10, right: 10, bottom: 20, left: 40 }

export type Line = { key: string; label: string; color: string; points: number[] }

// Hand-rolled multi-line SVG trend (no chart library); handles negative values.
export function TrendLines({
  months,
  lines,
  ariaLabel,
  granularity,
}: {
  months: string[]
  lines: Line[]
  ariaLabel: string
  granularity: Granularity
}) {
  const uid = useId()
  const [hover, setHover] = useState<number | null>(null)
  const active = lines.filter(l => l.points.some(p => p !== 0))
  if (!months.length || !active.length) {
    return <p className="text-xs text-foreground-muted py-8 text-center">No data in this range.</p>
  }

  const flat = active.flatMap(l => l.points)
  const maxY = Math.max(1, ...flat)
  const minY = Math.min(0, ...flat)
  const span = maxY - minY || 1
  const plotW = VIEW_W - PAD.left - PAD.right
  const plotH = VIEW_H - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + (months.length <= 1 ? plotW / 2 : (i / (months.length - 1)) * plotW)
  const y = (v: number) => PAD.top + plotH - ((v - minY) / span) * plotH
  const yTicks = [maxY, minY + span / 2, minY]
  const xStep = months.length <= 8 ? 1 : Math.ceil(months.length / 7)

  return (
    <div className="w-full">
      <div className="overflow-x-auto">
        <div className="relative min-w-[320px]" style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}>
          <svg
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            className="w-full h-full"
            preserveAspectRatio="none"
            role="img"
            aria-label={ariaLabel}
          >
            {yTicks.map((t, i) => (
              <g key={`y${uid}${i}`}>
                <line
                  x1={PAD.left}
                  x2={VIEW_W - PAD.right}
                  y1={y(t)}
                  y2={y(t)}
                  className="stroke-border-default"
                  strokeWidth={1}
                  strokeDasharray={i === yTicks.length - 1 ? undefined : '3 3'}
                />
                <text
                  x={PAD.left - 4}
                  y={y(t) + 3}
                  textAnchor="end"
                  className="fill-foreground-muted"
                  fontSize={9}
                >
                  {rsCompact(t).replace('Rs ', '')}
                </text>
              </g>
            ))}

            {months.map(
              (m, i) =>
                (i % xStep === 0 || i === months.length - 1) && (
                  <text
                    key={`x${uid}${m}`}
                    x={x(i)}
                    y={VIEW_H - 6}
                    textAnchor="middle"
                    className="fill-foreground-muted"
                    fontSize={9}
                  >
                    {bucketLabel(m, granularity)}
                  </text>
                )
            )}

            {hover !== null && (
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD.top}
                y2={PAD.top + plotH}
                className="stroke-border-default"
                strokeWidth={1}
              />
            )}

            {active.map(l => (
              <g key={l.key}>
                <polyline
                  fill="none"
                  stroke={l.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  points={l.points.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
                />
                {l.points.map((v, i) => (
                  <circle key={i} cx={x(i)} cy={y(v)} r={hover === i ? 3.5 : 2} fill={l.color} />
                ))}
              </g>
            ))}

            {months.map((m, i) => (
              <rect
                key={`h${uid}${m}`}
                x={x(i) - plotW / (2 * Math.max(1, months.length - 1 || 1))}
                y={PAD.top}
                width={Math.max(8, plotW / Math.max(1, months.length))}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            ))}
          </svg>

          {hover !== null && months[hover] && (
            <div
              className="absolute z-10 text-[11px] rounded-lg px-2.5 py-2 shadow-lg pointer-events-none bg-surface-elevated ring-1 ring-border-default"
              style={{ left: `${(x(hover) / VIEW_W) * 100}%`, top: 0, transform: 'translateX(-50%)' }}
            >
              <div className="font-semibold mb-1 text-foreground whitespace-nowrap">{bucketLabel(months[hover], granularity, true)}</div>
              {active.map(l => (
                <div key={l.key} className="flex items-center gap-1.5 whitespace-nowrap">
                  <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: l.color }} />
                  <span className="text-foreground-muted">{l.label}</span>
                  <span className="ml-auto font-semibold tabular-nums text-foreground">
                    {rsCompact(l.points[hover])}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
        {active.map(l => (
          <div key={l.key} className="flex items-center gap-1.5 text-xs text-foreground-secondary">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: l.color }} />
            {l.label}
          </div>
        ))}
      </div>
    </div>
  )
}

export const GRAN_HINT: Record<Granularity, string> = { day: 'by day', week: 'by week', month: 'by month' }
export const num = (p: TrendPoint, k: string) => Number(p[k]) || 0

export function MixDonutCard({
  title,
  hint,
  segments,
  total,
  totalLabel,
}: {
  title: string
  hint?: string
  segments: OutflowSegment[]
  total: string
  totalLabel: string
}) {
  return (
    <ChartCard title={title} hint={hint}>
      {segments.length ? (
        <DonutSplit segments={segments} centerValue={total} centerLabel={totalLabel} />
      ) : (
        <p className="text-xs text-foreground-muted py-8 text-center">No data in this range.</p>
      )}
    </ChartCard>
  )
}

const SERIES_PALETTE = ['rgb(59 130 246)', 'rgb(16 185 129)', 'rgb(234 179 8)', 'rgb(168 85 247)', 'rgb(239 68 68)', 'rgb(236 72 153)']

/** One line per key (e.g. AI cost per provider) over the period. */
export function KeyedTrendCard({
  title,
  hint,
  data,
  keys,
  labels,
  granularity,
}: {
  title: string
  hint?: string
  data: TrendPoint[]
  keys: string[]
  labels?: Record<string, string>
  granularity: Granularity
}) {
  const lines: Line[] = keys.map((k, i) => ({
    key: k,
    label: labels?.[k] ?? k,
    color: SERIES_PALETTE[i % SERIES_PALETTE.length],
    points: data.map(d => num(d, k)),
  }))
  return (
    <ChartCard title={title} hint={hint ?? GRAN_HINT[granularity]}>
      <TrendLines months={data.map(d => d.label)} lines={lines} granularity={granularity} ariaLabel={`${title} over the period.`} />
    </ChartCard>
  )
}

/** Ranked horizontal bars in a card (top suppliers, products, channels). */
export function RankedBarsCard({ title, hint, items, barClass }: { title: string; hint?: string; items: RankedItem[]; barClass?: string }) {
  return (
    <ChartCard title={title} hint={hint}>
      {items.length ? <RankedBars items={items} barClass={barClass} /> : <p className="text-xs text-foreground-muted py-8 text-center">No data in this range.</p>}
    </ChartCard>
  )
}

// Dashboard charts (merged from components/admin/dashboard/Charts.tsx and Primitives.tsx).

type OrderTrendPoint = {
  label: string
  revenue: number
  orders: number
  paidOrders: number
  customers: number
  units: number
  aov: number
}

/** Any time series row: a date label plus numeric values keyed by series. */
export type ChartPoint = { label: string } & Record<string, number | string>

type SeriesKey = string
type Axis = 'money' | 'count'
export interface SeriesDef {
  key: SeriesKey
  label: string
  color: string
  kind: 'area' | 'line' | 'bar'
  axis: Axis
  /** Initially shown; defaults to the first two series. */
  on?: boolean
}

const SERIES: SeriesDef[] = [
  { key: 'revenue', label: 'Revenue', color: 'rgb(16 185 129)', kind: 'area', axis: 'money' },
  { key: 'orders', label: 'Orders', color: 'rgb(224 123 63)', kind: 'bar', axis: 'count' },
  { key: 'paidOrders', label: 'Paid Orders', color: 'rgb(59 130 246)', kind: 'line', axis: 'count' },
  { key: 'aov', label: 'AOV', color: 'rgb(168 85 247)', kind: 'line', axis: 'money' },
  { key: 'units', label: 'Units', color: 'rgb(234 179 8)', kind: 'line', axis: 'count' },
  { key: 'customers', label: 'Customers', color: 'rgb(236 72 153)', kind: 'line', axis: 'count' },
]

// "Nice" round ceiling for an axis max so gridline labels read cleanly (1/2/5 × 10ⁿ).
function niceMax(v: number): number {
  if (v <= 0) return 1
  const pow = Math.pow(10, Math.floor(Math.log10(v)))
  const f = v / pow
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10
  return nice * pow
}
// Compact number: 1234 → "1.2k", 1500000 → "1.5M".
function compact(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e7) return `${(v / 1e7).toFixed(1).replace(/\.0$/, '')}Cr`
  if (a >= 1e5) return `${(v / 1e5).toFixed(1).replace(/\.0$/, '')}L`
  if (a >= 1e3) return `${(v / 1e3).toFixed(1).replace(/\.0$/, '')}k`
  return String(Math.round(v))
}

export type TrendBucket = 'hour' | 'day' | 'week' | 'month'

function inferBucket(points: { label: string }[]): TrendBucket {
  const times = points.map(p => new Date(p.label).getTime()).filter(t => !isNaN(t))
  if (times.length < 2) return 'day'
  const gaps = times
    .slice(1)
    .map((t, i) => t - times[i])
    .filter(g => g > 0)
    .sort((a, b) => a - b)
  const g = gaps[Math.floor(gaps.length / 2)] || 0
  if (g <= 2 * 3600_000) return 'hour'
  if (g <= 2 * 86400_000) return 'day'
  if (g <= 20 * 86400_000) return 'week'
  return 'month'
}

function formatBucket(iso: string, bucket: TrendBucket, full: boolean): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const day = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  if (bucket === 'hour') {
    const start = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
    return full ? `${day}, ${start}` : start
  }
  if (bucket === 'month') return d.toLocaleDateString('en-IN', { month: 'short', year: full ? 'numeric' : '2-digit' })
  if (bucket === 'week') return full ? `Week of ${day}` : day
  return full ? d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) : day
}

/**
 * Hand-rolled SVG trend chart (no chart library). Plots several representations
 * of the same order time series in one graph — revenue (area), orders (bars),
 * and paid-orders / AOV / units / customers (lines). Series map to one of TWO
 * shared axes by magnitude: money (₹, left) and counts (right). Toggle each
 * series via chips. Hovering (or arrow keys once focused) snaps a crosshair to
 * the nearest bucket and shows every visible series' value for it.
 */
export function TrendChart({
  points,
  height = 240,
  bucket,
  series,
  ariaLabel = 'Revenue and orders over time',
}: {
  points: OrderTrendPoint[] | ChartPoint[]
  height?: number
  bucket?: TrendBucket
  /** Series to plot; defaults to the order series (revenue, orders, ...). */
  series?: SeriesDef[]
  ariaLabel?: string
}) {
  const SERIES_DEFS = series ?? SERIES
  const [active, setActive] = useState<Record<SeriesKey, boolean>>(() =>
    Object.fromEntries(SERIES_DEFS.map((s, i) => [s.key, s.on ?? i < 2]))
  )
  const [hover, setHover] = useState<number | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)

  if (!points.length) {
    return (
      <div className="flex items-center justify-center text-xs text-foreground-muted" style={{ height }}>
        No data in this range
      </div>
    )
  }

  // Normalized 0..100 coordinate space in BOTH axes so the SVG can stretch to any
  // width/height (preserveAspectRatio="none") and still fill the container fully.
  // Axis labels, markers and the tooltip are HTML positioned by percentage, so they
  // never distort with the stretch.
  const n = points.length
  const val = (p: OrderTrendPoint | ChartPoint, key: SeriesKey) => {
    const v = (p as ChartPoint)[key]
    return typeof v === 'number' && isFinite(v) ? v : 0
  }
  const insetT = 3,
    insetB = 3,
    insetX = 1
  const px = (i: number) => insetX + (n === 1 ? (100 - insetX * 2) / 2 : (i / (n - 1)) * (100 - insetX * 2))

  const activeSeries = SERIES_DEFS.filter(s => active[s.key])
  const hasMoney = activeSeries.some(s => s.axis === 'money')
  const hasCount = activeSeries.some(s => s.axis === 'count')
  const axisMax = (axis: Axis) => {
    const keys = activeSeries.filter(s => s.axis === axis).map(s => s.key)
    const raw = Math.max(0, ...points.flatMap(p => keys.map(k => val(p, k))))
    return niceMax(raw)
  }
  const leftMax = axisMax('money')
  const rightMax = axisMax('count')
  const pyFor = (s: SeriesDef) => {
    const max = s.axis === 'money' ? leftMax : rightMax
    return (v: number) => insetT + (1 - v / (max || 1)) * (100 - insetT - insetB)
  }
  const slot = (100 - insetX * 2) / Math.max(1, n)
  const barW = Math.min(2.5, Math.max(0.5, slot * 0.45))

  const gran = bucket ?? inferBucket(points)
  const fmtTick = (iso: string) => formatBucket(iso, gran, false)
  const fmtFull = (iso: string) => formatBucket(iso, gran, true)
  const fmtVal = (v: number, axis: Axis) =>
    axis === 'money' ? `Rs ${Math.round(v).toLocaleString('en-IN')}` : Math.round(v).toLocaleString('en-IN')

  const GRID = 4
  const xTickCount = Math.min(n, 7)
  const xTickIdx =
    n <= 1
      ? [0]
      : Array.from(new Set(Array.from({ length: xTickCount }, (_, k) => Math.round((k / (xTickCount - 1)) * (n - 1)))))
  const gridPY = (t: number) => insetT + (1 - t / GRID) * (100 - insetT - insetB)

  const nearestIndex = (clientX: number): number | null => {
    const el = canvasRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) return null
    if (n === 1) return 0
    const xPct = ((clientX - rect.left) / rect.width) * 100
    const t = (xPct - insetX) / (100 - insetX * 2)
    return Math.min(n - 1, Math.max(0, Math.round(t * (n - 1))))
  }
  const onPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const i = nearestIndex(e.clientX)
    if (i !== null && i !== hover) setHover(i)
  }
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      setHover(h => Math.min(n - 1, (h ?? -1) + 1))
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      setHover(h => Math.max(0, (h ?? n) - 1))
    } else if (e.key === 'Escape') setHover(null)
  }
  const hp = hover !== null ? points[hover] : null
  const hx = hover !== null ? px(hover) : 0
  const tipOnLeft = hx > 55
  const canvasStyle = { left: hasMoney ? 40 : 4, right: hasCount ? 40 : 4 }

  return (
    <div className="w-full">
      <div className="flex items-center gap-2 overflow-x-auto -mx-4 px-4 pb-1 mb-3">
        {SERIES_DEFS.map(s => (
          <SeriesChip
            key={s.key}
            label={s.label}
            color={s.color}
            activeState={active[s.key]}
            onClick={() => setActive(a => ({ ...a, [s.key]: !a[s.key] }))}
          />
        ))}
      </div>

      <div className="overflow-x-auto -mx-4 px-4">
      <div className="relative min-w-[640px]" style={{ height }}>
        {hasMoney && (
          <div className="absolute left-0 top-0 w-9" style={{ bottom: 20 }}>
            {Array.from({ length: GRID + 1 }, (_, t) => (
              <span
                key={`ly${t}`}
                className="absolute right-1 -translate-y-1/2 text-[10px] tabular-nums text-foreground-muted"
                style={{ top: `${gridPY(t)}%` }}
              >
                {compact((leftMax * t) / GRID)}
              </span>
            ))}
          </div>
        )}
        {hasCount && (
          <div className="absolute right-0 top-0 w-9" style={{ bottom: 20 }}>
            {Array.from({ length: GRID + 1 }, (_, t) => (
              <span
                key={`ry${t}`}
                className="absolute left-1 -translate-y-1/2 text-[10px] tabular-nums text-foreground-muted"
                style={{ top: `${gridPY(t)}%` }}
              >
                {compact((rightMax * t) / GRID)}
              </span>
            ))}
          </div>
        )}

        {/* The stretchable chart canvas, also the hover surface: the whole plot is the hit target. */}
        <div
          ref={canvasRef}
          className="absolute top-0 outline-none rounded focus-visible:ring-2 focus-visible:ring-accent-500/50 touch-none"
          style={{ ...canvasStyle, bottom: 20 }}
          role="img"
          aria-label={`${ariaLabel}. Use the arrow keys to read each point.`}
          tabIndex={0}
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          onPointerLeave={() => setHover(null)}
          onKeyDown={onKey}
          onBlur={() => setHover(null)}
        >
          <svg viewBox="0 0 100 100" className="w-full h-full block" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgb(16 185 129)" stopOpacity="0.22" />
                <stop offset="100%" stopColor="rgb(16 185 129)" stopOpacity="0" />
              </linearGradient>
            </defs>

            {Array.from({ length: GRID + 1 }, (_, t) => (
              <line
                key={`hg${t}`}
                x1={0}
                y1={gridPY(t)}
                x2={100}
                y2={gridPY(t)}
                className="stroke-border-default"
                strokeWidth={0.5}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {xTickIdx.map(i => (
              <line
                key={`vg${i}`}
                x1={px(i)}
                y1={insetT}
                x2={px(i)}
                y2={100 - insetB}
                className="stroke-border-default"
                strokeWidth={0.5}
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {activeSeries
              .filter(s => s.kind === 'bar')
              .map(s => {
                const y = pyFor(s)
                return points.map((p, i) => {
                  const yv = y(val(p, s.key))
                  const h = 100 - insetB - yv
                  return (
                    <rect
                      key={`${s.key}${i}`}
                      x={px(i) - barW / 2}
                      y={yv}
                      width={barW}
                      height={Math.max(0, h)}
                      rx={0.4}
                      fill={s.color}
                      fillOpacity={hover === i ? 0.7 : 0.35}
                    />
                  )
                })
              })}
            {activeSeries
              .filter(s => s.kind === 'area')
              .map(s => {
                const y = pyFor(s)
                const line = points.map((p, i) => `${px(i)},${y(val(p, s.key))}`).join(' ')
                return (
                  <g key={s.key}>
                    <polygon
                      points={`${px(0)},${100 - insetB} ${line} ${px(n - 1)},${100 - insetB}`}
                      fill="url(#trendFill)"
                    />
                    <polyline
                      points={line}
                      fill="none"
                      stroke={s.color}
                      strokeWidth={2}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                )
              })}
            {activeSeries
              .filter(s => s.kind === 'line')
              .map(s => {
                const y = pyFor(s)
                const line = points.map((p, i) => `${px(i)},${y(val(p, s.key))}`).join(' ')
                return (
                  <polyline
                    key={s.key}
                    points={line}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                )
              })}

            {hover !== null && (
              <line
                x1={hx}
                y1={insetT}
                x2={hx}
                y2={100 - insetB}
                className="stroke-foreground-muted"
                strokeWidth={1}
                strokeDasharray="4 3"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>

          {hp &&
            activeSeries
              .filter(s => s.kind !== 'bar')
              .map(s => (
                <span
                  key={`m${s.key}`}
                  className="absolute w-2.5 h-2.5 rounded-full border-2 border-surface-elevated pointer-events-none"
                  style={{
                    left: `${hx}%`,
                    top: `${pyFor(s)(val(hp, s.key))}%`,
                    transform: 'translate(-50%, -50%)',
                    background: s.color,
                  }}
                />
              ))}

          {hp && (
            <div
              className="absolute top-2 z-10 pointer-events-none min-w-[9rem] rounded-lg bg-surface-elevated ring-1 ring-border-default shadow-lg px-3 py-2 text-xs"
              style={{ left: `${hx}%`, transform: tipOnLeft ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)' }}
            >
              <p className="font-semibold text-foreground mb-1.5 whitespace-nowrap">{fmtFull(hp.label)}</p>
              {activeSeries.length === 0 ? (
                <p className="text-foreground-muted whitespace-nowrap">Turn on a series above</p>
              ) : (
                <ul className="space-y-1">
                  {activeSeries.map(s => (
                    <li key={s.key} className="flex items-center gap-2 whitespace-nowrap">
                      <span className="w-3 h-0.5 rounded-full shrink-0" style={{ background: s.color }} />
                      <span className="font-bold tabular-nums text-foreground">{fmtVal(val(hp, s.key), s.axis)}</span>
                      <span className="text-foreground-muted">{s.label}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="absolute bottom-0 h-5" style={canvasStyle}>
          {xTickIdx.map((i, k) => (
            <span
              key={`xt${i}`}
              className="absolute text-[10px] text-foreground-muted whitespace-nowrap"
              style={{
                left: `${px(i)}%`,
                transform:
                  k === 0 ? 'translateX(0)' : k === xTickIdx.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
              }}
            >
              {fmtTick(points[i].label)}
            </span>
          ))}
        </div>
      </div>
      </div>
    </div>
  )
}

function SeriesChip({
  label,
  color,
  activeState,
  onClick,
}: {
  label: string
  color: string
  activeState: boolean
  onClick: () => void
}) {
  // Derive translucent tints from the series' `rgb(r g b)` color.
  const bg = color.replace('rgb(', 'rgb(').replace(')', ' / 0.14)') // rgb(r g b / 0.14)
  const bgHover = color.replace(')', ' / 0.22)')
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activeState}
      className={`inline-flex items-center px-3 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
        activeState ? '' : 'border-transparent text-foreground-muted opacity-55 hover:opacity-100'
      }`}
      style={activeState ? { background: bg, borderColor: color, color } : undefined}
      onMouseEnter={
        activeState
          ? e => {
              e.currentTarget.style.background = bgHover
            }
          : undefined
      }
      onMouseLeave={
        activeState
          ? e => {
              e.currentTarget.style.background = bg
            }
          : undefined
      }
    >
      {label}
    </button>
  )
}

/**
 * Hand-rolled SVG donut for 2–4 segment splits (payment mode, buyer type, etc.).
 * Renders proportional arcs with a centered total and a legend.
 */
export function DonutSplit({
  segments,
  centerLabel,
  centerValue,
  size = 140,
}: {
  segments: { label: string; value: number; color: string }[]
  centerLabel?: string
  centerValue?: string
  size?: number
}) {
  const total = segments.reduce((s, x) => s + x.value, 0)
  const R = size / 2
  const stroke = size * 0.16
  const r = R - stroke / 2
  const circ = 2 * Math.PI * r
  let offset = 0

  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90">
        <circle
          cx={R}
          cy={R}
          r={r}
          fill="none"
          stroke="currentColor"
          className="text-surface-secondary"
          strokeWidth={stroke}
        />
        {total > 0 &&
          segments.map((seg, i) => {
            const frac = seg.value / total
            const dash = frac * circ
            const el = (
              <circle
                key={i}
                cx={R}
                cy={R}
                r={r}
                fill="none"
                stroke={seg.color}
                strokeWidth={stroke}
                strokeDasharray={`${dash} ${circ - dash}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
              />
            )
            offset += dash
            return el
          })}
      </svg>
      <div className="min-w-0">
        {(centerValue || centerLabel) && (
          <div className="mb-1.5">
            {centerValue && (
              <p className="text-lg font-bold text-foreground leading-none tabular-nums">{centerValue}</p>
            )}
            {centerLabel && <p className="text-xs text-foreground-muted">{centerLabel}</p>}
          </div>
        )}
        <ul className="space-y-1">
          {segments.map((seg, i) => {
            const pct = total > 0 ? Math.round((seg.value / total) * 100) : 0
            return (
              <li key={i} className="flex items-center gap-2 text-xs">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: seg.color }} />
                <span className="text-foreground-secondary flex-1 min-w-0 truncate">{seg.label}</span>
                <span className="text-foreground font-semibold tabular-nums">{pct}%</span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

/**
 * Ranked horizontal bars (top categories / brands / products). Generalizes the
 * dashboard's top-products bar pattern.
 */
export function RankedBars({
  items,
  unit = 'units',
  barClass = 'bg-accent-500',
}: {
  items: { name: string; value: number; sub?: string }[]
  unit?: string
  barClass?: string
}) {
  if (!items.length) return <p className="text-xs text-foreground-muted">No data in this range.</p>
  const max = Math.max(1, ...items.map(i => i.value))
  return (
    <div className="space-y-3">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="text-xs font-bold text-foreground-muted w-4 shrink-0">{i + 1}</span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground truncate">{it.name}</p>
            <div className="mt-1 h-1.5 bg-surface-secondary rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${barClass}`}
                style={{ width: `${Math.max(3, Math.round((it.value / max) * 100))}%` }}
              />
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs font-semibold text-foreground tabular-nums">
              {it.sub || `${it.value.toLocaleString('en-IN')} ${unit}`}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

/** 24 thin bars, one per hour of the day, busiest hour highlighted. */
export function HourBars({ counts, tone = 'accent', unit = 'orders' }: { counts: number[]; tone?: 'accent' | 'sky'; unit?: string }) {
  const max = Math.max(1, ...counts)
  const peak = counts.indexOf(max)
  const total = counts.reduce((s, n) => s + n, 0)
  const barPeak = tone === 'sky' ? 'bg-sky-500' : 'bg-accent-500'
  const barRest = tone === 'sky' ? 'bg-sky-500/40' : 'bg-accent-500/45'
  return (
    <div>
      <div className="flex items-end gap-[3px] h-16">
        {counts.map((n, h) => (
          <div key={h} className="flex-1 flex flex-col justify-end h-full" title={`${String(h).padStart(2, '0')}:00  ${n} ${unit}`}>
            <div
              className={`w-full rounded-sm ${total > 0 && h === peak ? barPeak : barRest}`}
              style={{ height: `${Math.max(n > 0 ? 6 : 2, Math.round((n / max) * 100))}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-foreground-muted mt-1 tabular-nums">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>23</span>
      </div>
      <p className="text-xs text-foreground-secondary mt-2">
        {total > 0
          ? `Busiest hour ${String(peak).padStart(2, '0')}:00 to ${String(peak + 1).padStart(2, '0')}:00 with ${numStr(max)} ${unit} (IST)`
          : `No ${unit} in this range.`}
      </p>
    </div>
  )
}

export const FUNNEL_STAGES = [
  { key: 'pending', label: 'Pending', dot: 'bg-amber-500' },
  { key: 'processing', label: 'Processing', dot: 'bg-blue-500' },
  { key: 'shipped', label: 'Shipped', dot: 'bg-indigo-500' },
  { key: 'out_for_delivery', label: 'Out for Delivery', dot: 'bg-violet-500' },
  { key: 'delivered', label: 'Delivered', dot: 'bg-accent-500' },
  { key: 'cancelled', label: 'Cancelled', dot: 'bg-red-500' },
] as const

/** Order status funnel: a segmented bar plus one linked count per stage. */
export function FunnelBar({ counts, hrefFor }: { counts: Record<string, number>; hrefFor: (key: string) => string }) {
  const total = FUNNEL_STAGES.reduce((s, st) => s + (counts[st.key] || 0), 0)
  return (
    <div className="space-y-3">
      <div className="flex gap-1 h-2.5">
        {FUNNEL_STAGES.map(st => {
          const v = counts[st.key] || 0
          return (
            <Link
              key={st.key}
              href={hrefFor(st.key)}
              className={`${st.dot} rounded-full hover:opacity-80 transition-opacity`}
              style={{ flexGrow: v || 0.15 }}
              title={`${st.label}: ${v}${total ? ` (${Math.round((v / total) * 100)}%)` : ''}`}
            />
          )
        })}
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {FUNNEL_STAGES.map(st => (
          <Link key={st.key} href={hrefFor(st.key)} className="group rounded-lg px-2 py-1.5 hover:bg-surface-secondary transition-colors">
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${st.dot}`} />
              <span className="text-xs text-foreground-muted truncate group-hover:text-foreground transition-colors">{st.label}</span>
            </div>
            <p className="text-base font-bold tabular-nums mt-0.5 text-foreground">{counts[st.key] || 0}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}

/** Legend rows that link somewhere (beside a donut). */
export function LinkedLegend({ items }: { items: { label: string; value: string; color: string; href: string }[] }) {
  return (
    <ul className="mt-3 space-y-0.5">
      {items.map((it, i) => (
        <li key={i}>
          <Link href={it.href} className="flex items-center gap-2 text-xs rounded-md px-1 -mx-1 h-control-sm hover:bg-surface-secondary transition-colors">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: it.color }} />
            <span className="text-foreground-secondary flex-1 min-w-0 truncate">{it.label}</span>
            <span className="text-foreground font-semibold tabular-nums">{it.value}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
