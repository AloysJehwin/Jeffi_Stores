'use client'

// Chart cards for every admin page (promoted from financial/_components/OverviewCharts.tsx).
// Trend lines own their empty state, hover tooltip and IST bucket labels.

import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { DonutSplit, RankedBars } from '@/components/admin/dashboard/Charts'
import { rsCompact } from '@/components/admin/dashboard/Primitives'

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

export { DonutSplit, RankedBars }
export { TrendChart } from '@/components/admin/dashboard/Charts'
