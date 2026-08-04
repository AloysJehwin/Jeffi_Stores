'use client'

import { useState } from 'react'

interface TrendPoint {
  label: string
  revenue: number
  orders: number
  paidOrders: number
  customers: number
  units: number
  aov: number
}

type SeriesKey = keyof Omit<TrendPoint, 'label'>
type Axis = 'money' | 'count'
interface SeriesDef { key: SeriesKey; label: string; color: string; kind: 'area' | 'line' | 'bar'; axis: Axis }

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

/**
 * Hand-rolled SVG trend chart (no chart library). Plots several representations
 * of the same order time series in one graph — revenue (area), orders (bars),
 * and paid-orders / AOV / units / customers (lines). Series map to one of TWO
 * shared axes by magnitude: money (₹, left) and counts (right). Series on the
 * same axis overlap meaningfully; the dual scale keeps ₹50k and "12 customers"
 * from being stretched to the same height. Toggle each series via chips.
 */
export function TrendChart({ points, height = 240 }: { points: TrendPoint[]; height?: number }) {
  const [active, setActive] = useState<Record<SeriesKey, boolean>>({
    revenue: true, orders: true, paidOrders: false, aov: false, units: false, customers: false,
  })

  if (!points.length) {
    return <div className="flex items-center justify-center text-xs text-foreground-muted" style={{ height }}>No data in this range</div>
  }

  // Normalized 0..100 coordinate space in BOTH axes so the SVG can stretch to any
  // width/height (preserveAspectRatio="none") and still fill the container fully.
  // Axis LABELS are rendered as absolutely-positioned HTML (percentages), so they
  // never distort with the stretch and stay crisp.
  const n = points.length
  const val = (p: TrendPoint, key: SeriesKey) => {
    const v = p[key]
    return typeof v === 'number' && isFinite(v) ? v : 0
  }
  // Plot inset (as % of the box) — leaves room for the HTML axis gutters.
  const insetT = 3, insetB = 3, insetX = 1
  const px = (i: number) => insetX + (n === 1 ? (100 - insetX * 2) / 2 : (i / (n - 1)) * (100 - insetX * 2))

  const activeSeries = SERIES.filter(s => active[s.key])
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

  const fmtDate = (iso: string) => {
    const d = new Date(iso)
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  }
  const fmtVal = (v: number, axis: Axis) => axis === 'money' ? `Rs ${Math.round(v).toLocaleString('en-IN')}` : Math.round(v).toLocaleString('en-IN')

  // ~5 horizontal gridlines; ~7 evenly spaced X ticks (endpoints always shown).
  const GRID = 4
  const xTickCount = Math.min(n, 7)
  const xTickIdx = n <= 1 ? [0] : Array.from(new Set(
    Array.from({ length: xTickCount }, (_, k) => Math.round((k / (xTickCount - 1)) * (n - 1)))
  ))
  const gridPY = (t: number) => insetT + (1 - t / GRID) * (100 - insetT - insetB)     // % from top

  return (
    <div className="w-full">
      <div className="flex items-center gap-2 flex-wrap mb-3">
        {SERIES.map(s => (
          <SeriesChip key={s.key} label={s.label} color={s.color} activeState={active[s.key]}
            onClick={() => setActive(a => ({ ...a, [s.key]: !a[s.key] }))} />
        ))}
      </div>

      {/* Plot area: full-width relative box. Left/right gutters hold HTML axis
          labels; the SVG fills the middle and stretches to the whole space. */}
      <div className="relative w-full" style={{ height }}>
        {/* Left Y-axis labels (money) — column spans exactly the canvas height */}
        {hasMoney && (
          <div className="absolute left-0 top-0 w-9" style={{ bottom: 20 }}>
            {Array.from({ length: GRID + 1 }, (_, t) => (
              <span key={`ly${t}`} className="absolute right-1 -translate-y-1/2 text-[10px] tabular-nums text-foreground-muted" style={{ top: `${gridPY(t)}%` }}>
                {compact((leftMax * t) / GRID)}
              </span>
            ))}
          </div>
        )}
        {/* Right Y-axis labels (counts) */}
        {hasCount && (
          <div className="absolute right-0 top-0 w-9" style={{ bottom: 20 }}>
            {Array.from({ length: GRID + 1 }, (_, t) => (
              <span key={`ry${t}`} className="absolute left-1 -translate-y-1/2 text-[10px] tabular-nums text-foreground-muted" style={{ top: `${gridPY(t)}%` }}>
                {compact((rightMax * t) / GRID)}
              </span>
            ))}
          </div>
        )}

        {/* The stretchable chart canvas */}
        <div className="absolute top-0" style={{ left: hasMoney ? 40 : 4, right: hasCount ? 40 : 4, bottom: 20 }}>
          <svg viewBox="0 0 100 100" className="w-full h-full block" preserveAspectRatio="none">
            <defs>
              <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgb(16 185 129)" stopOpacity="0.22" />
                <stop offset="100%" stopColor="rgb(16 185 129)" stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Gridlines — light gray (adapts to dark mode), sitting behind the data. */}
            {Array.from({ length: GRID + 1 }, (_, t) => (
              <line key={`hg${t}`} x1={0} y1={gridPY(t)} x2={100} y2={gridPY(t)}
                className="stroke-zinc-200 dark:stroke-zinc-700/60" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
            ))}
            {xTickIdx.map(i => (
              <line key={`vg${i}`} x1={px(i)} y1={insetT} x2={px(i)} y2={100 - insetB}
                className="stroke-zinc-200 dark:stroke-zinc-700/60" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
            ))}

            {/* Bars (behind), areas, then lines */}
            {activeSeries.filter(s => s.kind === 'bar').map(s => {
              const y = pyFor(s)
              return points.map((p, i) => {
                const yv = y(val(p, s.key))
                const h = (100 - insetB) - yv
                return <rect key={`${s.key}${i}`} x={px(i) - barW / 2} y={yv} width={barW} height={Math.max(0, h)} rx={0.4} fill={s.color} fillOpacity={0.35} />
              })
            })}
            {activeSeries.filter(s => s.kind === 'area').map(s => {
              const y = pyFor(s)
              const line = points.map((p, i) => `${px(i)},${y(val(p, s.key))}`).join(' ')
              return (
                <g key={s.key}>
                  <polygon points={`${px(0)},${100 - insetB} ${line} ${px(n - 1)},${100 - insetB}`} fill="url(#trendFill)" />
                  <polyline points={line} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                </g>
              )
            })}
            {activeSeries.filter(s => s.kind === 'line').map(s => {
              const y = pyFor(s)
              const line = points.map((p, i) => `${px(i)},${y(val(p, s.key))}`).join(' ')
              return <polyline key={s.key} points={line} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            })}

            {/* Invisible hover targets — native tooltip lists all active series */}
            {points.map((p, i) => (
              <rect key={`h${i}`} x={px(i) - slot / 2} y={insetT} width={slot} height={100 - insetT - insetB} fill="transparent">
                <title>{`${fmtDate(p.label)}\n${activeSeries.map(s => `${s.label}: ${fmtVal(val(p, s.key), s.axis)}`).join('\n')}`}</title>
              </rect>
            ))}
          </svg>
        </div>

        {/* X-axis date labels (HTML, non-distorting) aligned to the canvas */}
        <div className="absolute bottom-0 h-5" style={{ left: hasMoney ? 40 : 4, right: hasCount ? 40 : 4 }}>
          {xTickIdx.map((i, k) => (
            <span key={`xt${i}`}
              className="absolute text-[10px] text-foreground-muted whitespace-nowrap"
              style={{
                left: `${px(i)}%`,
                transform: k === 0 ? 'translateX(0)' : k === xTickIdx.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
              }}>
              {fmtDate(points[i].label)}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function SeriesChip({ label, color, activeState, onClick }: { label: string; color: string; activeState: boolean; onClick: () => void }) {
  // Derive translucent tints from the series' `rgb(r g b)` color.
  const bg = color.replace('rgb(', 'rgb(').replace(')', ' / 0.14)')   // rgb(r g b / 0.14)
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
      onMouseEnter={activeState ? (e) => { e.currentTarget.style.background = bgHover } : undefined}
      onMouseLeave={activeState ? (e) => { e.currentTarget.style.background = bg } : undefined}
    >
      {label}
    </button>
  )
}

/**
 * Hand-rolled SVG donut for 2–4 segment splits (payment mode, buyer type, etc.).
 * Renders proportional arcs with a centered total and a legend.
 */
export function DonutSplit({ segments, centerLabel, centerValue, size = 140 }: {
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
        <circle cx={R} cy={R} r={r} fill="none" stroke="currentColor" className="text-surface-secondary" strokeWidth={stroke} />
        {total > 0 && segments.map((seg, i) => {
          const frac = seg.value / total
          const dash = frac * circ
          const el = (
            <circle
              key={i}
              cx={R} cy={R} r={r} fill="none"
              stroke={seg.color} strokeWidth={stroke}
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
            {centerValue && <p className="text-lg font-bold text-foreground leading-none tabular-nums">{centerValue}</p>}
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
export function RankedBars({ items, unit = 'units', barClass = 'bg-accent-500' }: {
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
              <div className={`h-full rounded-full ${barClass}`} style={{ width: `${Math.max(3, Math.round((it.value / max) * 100))}%` }} />
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs font-semibold text-foreground tabular-nums">{it.sub || `${it.value.toLocaleString('en-IN')} ${unit}`}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
