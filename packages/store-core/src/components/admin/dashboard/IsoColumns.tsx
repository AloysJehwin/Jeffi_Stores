'use client'

// Isometric daily-count chart: SVG prisms (weeks x weekdays), orbitable by yaw, morphing into a flat dot grid.
// Projection: grid coords (x = week, y = weekday, centred) are rotated by `yaw`, then squashed vertically (iso tilt);
// prism height lifts the top face straight up. Painting order is by rotated depth, recomputed for every yaw.

import { memo, useCallback, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { acc, dec1, dotFill, easeOut, fmtLong, GRID_LINE, NEUTRAL_FILL, nf, TIP_CLASS, usePrefersReducedMotion, useTween } from './viz'
import { ActivityLegend } from './DotCalendar'

export interface IsoDay {
  date: string
  value: number
  /** Tooltip breakdown, largest first; three are listed and the rest folds into "Others". */
  parts?: { name: string; count: number }[]
  /** Last tooltip line, e.g. "12 customers". */
  note?: string
}

export interface IsoColumnsProps {
  /** Monday-aligned days, weeks * 7. */
  days: IsoDay[]
  mode: '3d' | 'grid'
  /** YYYY-MM-DD; days after it are left out of the daily average. */
  today?: string
  /** What is counted, for the summary: "Orders shipped per day over 26 weeks". */
  subject?: string
  /** Word after a count: "12 shipped". */
  unit?: string
  emptyText?: string
  className?: string
}

export const DEFAULT_YAW = 45
const YAW_RANGE = 35
const VW = 600
const VH = 340
const CX = 300
const CY = 215
const MAXH = 70
const TILT = 0.5
const OFFS: [number, number][] = [
  [-0.46, -0.46],
  [0.46, -0.46],
  [0.46, 0.46],
  [-0.46, 0.46],
]
const TIP_SHADES = [700, 500, 300]

type Pt = [number, number]
interface Cell {
  iso: Pt[] // 4 base corners in the 3D projection
  grid: Pt[] // 4 corners in the flat grid layout
  isoC: Pt
  gridC: Pt
  depth: number
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
const pts = (p: Pt[]) => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')

interface PrismProps {
  i: number
  cell: Cell
  count: number
  H: number
  rise: number
  m: number
  hot: boolean
  onHover: (i: number | null) => void
}

const Prism = memo(function Prism({ i, cell, count, H, rise, m, hot, onHover }: PrismProps) {
  const h = H * rise * (1 - m)
  const p = cell.iso.map((c, k): Pt => [lerp(c[0], cell.grid[k][0], m), lerp(c[1], cell.grid[k][1], m)])
  const up = (q: Pt, dy: number): Pt => [q[0], q[1] - dy]
  const top = p.map(q => up(q, h))
  const op = 1 - clamp01((m - 0.55) / 0.45)
  return (
    <g data-prism={i} data-count={count} opacity={op} onPointerEnter={() => onHover(i)} onPointerLeave={() => onHover(null)}>
      {count > 0 && h > 0.2 && (
        <>
          <polygon points={pts([p[3], p[2], top[2], top[3]])} fill={acc(600)} />
          <polygon points={pts([p[1], p[2], top[2], top[1]])} fill={acc(500)} />
        </>
      )}
      <polygon points={pts(top)} fill={count > 0 ? (hot ? acc(200) : acc(300)) : NEUTRAL_FILL} stroke={count > 0 ? undefined : GRID_LINE} strokeWidth={count > 0 ? 0 : 0.5} strokeOpacity=".6" />
    </g>
  )
})

/** Isometric weeks x weekdays chart; `mode` morphs the columns into the DotCalendar's dots and back. */
export function IsoColumns({ days, mode, today, subject = 'Orders shipped', unit = 'shipped', emptyText = 'No shipments in this range.', className = '' }: IsoColumnsProps) {
  const reduced = usePrefersReducedMotion()
  const W = Math.max(1, Math.ceil(days.length / 7))
  const [yaw, setYaw] = useState(DEFAULT_YAW)
  const [hot, setHot] = useState<number | null>(null)
  const [cellFocus, setCellFocus] = useState(0)
  const drag = useRef<{ x: number; yaw: number } | null>(null)
  const root = useRef<HTMLDivElement>(null)

  const riseT = useTween(1, 650, reduced, 0)
  const m = easeOut(useTween(mode === 'grid' ? 1 : 0, 420, reduced))

  const max = useMemo(() => Math.max(0, ...days.map(d => d.value)), [days])
  const busiest = useMemo(() => (max > 0 ? days.findIndex(d => d.value === max) : -1), [days, max])
  const total = useMemo(() => days.reduce((s, d) => s + d.value, 0), [days])
  const dailyAvg = useMemo(() => {
    const live = today ? days.filter(d => d.date <= today) : days
    return live.length ? live.reduce((s, d) => s + d.value, 0) / live.length : 0
  }, [days, today])

  const gridCell = Math.min(560 / W, 40)
  const cells = useMemo<Cell[]>(() => {
    const th = (yaw * Math.PI) / 180
    const cos = Math.cos(th)
    const sin = Math.sin(th)
    const S = 240 / Math.hypot(W / 2, 3.5)
    const proj = (gx: number, gy: number): { p: Pt; depth: number } => {
      const rx = gx * cos - gy * sin
      const ry = gx * sin + gy * cos
      return { p: [CX + rx * S, CY + ry * S * TILT], depth: ry }
    }
    return days.map((_, i) => {
      const w = Math.floor(i / 7)
      const d = i % 7
      const gx = w - (W - 1) / 2
      const gy = d - 3
      const c = proj(gx, gy)
      const flat: Pt = [CX + gx * gridCell, 170 + gy * gridCell]
      return {
        iso: OFFS.map(([ox, oy]) => proj(gx + ox, gy + oy).p),
        grid: OFFS.map(([ox, oy]): Pt => [flat[0] + ox * gridCell * 0.8, flat[1] + oy * gridCell * 0.8]),
        isoC: c.p,
        gridC: flat,
        depth: c.depth,
      }
    })
  }, [days, yaw, W, gridCell])

  // Back to front: farther (smaller depth) first, recomputed whenever the yaw changes.
  const order = useMemo(() => cells.map((_, i) => i).sort((a, b) => cells[a].depth - cells[b].depth || a - b), [cells])

  const heights = useMemo(() => days.map(d => (d.value <= 0 || max <= 0 ? 0 : Math.max(2, (d.value / max) * MAXH))), [days, max])
  const riseOf = useCallback(
    (i: number) => {
      const key = (Math.floor(i / 7) + (i % 7)) / (W - 1 + 6 || 1)
      return easeOut(clamp01((riseT - key * 0.55) / 0.45))
    },
    [riseT, W]
  )

  const onHover = useCallback((i: number | null) => setHot(i), [])

  const hotDay = hot != null ? days[hot] : null
  const tip = (() => {
    if (hot == null || !hotDay) return null
    const c = cells[hot]
    const bx = lerp(c.isoC[0], c.gridC[0], m)
    const by = lerp(c.isoC[1], c.gridC[1], m) - heights[hot] * riseOf(hot) * (1 - m)
    return { x: (bx / VW) * 100, y: (by / VH) * 100 }
  })()

  const orbit = (to: number) => setYaw(Math.min(DEFAULT_YAW + YAW_RANGE, Math.max(DEFAULT_YAW - YAW_RANGE, to)))
  const onKey = (e: KeyboardEvent) => {
    if (mode !== '3d') return
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      orbit(yaw - 5)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      orbit(yaw + 5)
    } else if (e.key === 'Home' || e.key === '0') setYaw(DEFAULT_YAW)
  }
  const onDown = (e: PointerEvent) => {
    if (mode !== '3d') return
    drag.current = { x: e.clientX, yaw }
    try {
      ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    } catch {
      /* not capturable */
    }
  }
  const onMove = (e: PointerEvent) => {
    if (drag.current) orbit(drag.current.yaw + (e.clientX - drag.current.x) * 0.35)
  }
  const onUp = () => {
    drag.current = null
  }

  // Grid cells: roving tabindex, arrows move by day (up/down) and week (left/right).
  const onCellKey = (e: KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' ? 7 : e.key === 'ArrowLeft' ? -7 : e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const n = Math.min(days.length - 1, Math.max(0, i + step))
    setCellFocus(n)
    root.current?.querySelector<SVGElement>(`[data-cell="${n}"]`)?.focus()
  }

  const showPrisms = m < 1
  const showDots = m > 0
  const summary = `${subject} per day over ${W} weeks: ${nf(total)} in total${busiest >= 0 ? `, busiest ${fmtLong(days[busiest].date)} with ${days[busiest].value}` : ''}.`
  const empty = days.length === 0
  const shownParts = hotDay?.parts?.slice(0, 3) ?? []
  const others = hotDay ? Math.round((hotDay.value - shownParts.reduce((s, t) => s + t.count, 0)) * 100) / 100 : 0
  const hasNotes = days.some(d => d.note)
  const tipLeft = tip ? (tip.x > 62 ? '-105%' : tip.x < 20 ? '5%' : '-50%') : '0'

  if (empty) return <p className="py-10 text-center text-xs text-foreground-muted">{emptyText}</p>

  return (
    <div className={className}>
      <div
        ref={root}
        className="relative select-none overflow-hidden rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
        style={{ aspectRatio: `${VW} / ${VH}`, touchAction: mode === '3d' ? 'pan-y' : undefined }}
        role={mode === '3d' ? 'img' : 'group'}
        aria-label={mode === '3d' ? `${summary} Use left and right arrow keys to rotate.` : summary}
        tabIndex={mode === '3d' ? 0 : undefined}
        onKeyDown={onKey}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={() => setYaw(DEFAULT_YAW)}
        onBlur={() => mode === '3d' && setHot(null)}
        data-yaw={yaw}
        data-mode={mode}
      >
        <svg viewBox={`0 0 ${VW} ${VH}`} className={`absolute inset-0 h-full w-full ${mode === '3d' ? 'cursor-grab active:cursor-grabbing' : ''}`} data-yaw={yaw} aria-hidden={mode === '3d' ? 'true' : undefined}>
          {showPrisms &&
            order.map(i => (
              <Prism key={i} i={i} cell={cells[i]} count={days[i].value} H={heights[i]} rise={riseOf(i)} m={m} hot={hot === i} onHover={onHover} />
            ))}
          {showDots &&
            days.map((d, i) => {
              const c = cells[i]
              const focused = hot === i
              return (
                <g
                  key={d.date}
                  data-dot={i}
                  data-cell={mode === 'grid' ? i : undefined}
                  role={mode === 'grid' ? 'button' : undefined}
                  tabIndex={mode === 'grid' ? (cellFocus === i ? 0 : -1) : undefined}
                  aria-label={mode === 'grid' ? `${fmtLong(d.date)}: ${nf(d.value)} ${unit}` : undefined}
                  opacity={clamp01((m - 0.45) / 0.55)}
                  onPointerEnter={() => setHot(i)}
                  onPointerLeave={() => setHot(null)}
                  onFocus={() => {
                    setHot(i)
                    setCellFocus(i)
                  }}
                  onBlur={() => setHot(null)}
                  onKeyDown={e => onCellKey(e, i)}
                  className="outline-none focus-visible:[&>circle]:stroke-[2px]"
                >
                  <circle cx={c.gridC[0]} cy={c.gridC[1]} r={gridCell * (focused ? 0.42 : 0.34)} fill={dotFill(d.value, max)} stroke={d.value > 0 ? (focused ? acc(900) : undefined) : GRID_LINE} strokeWidth={d.value > 0 ? (focused ? 1.5 : 0) : 0.6} style={{ transition: 'r 150ms' }} />
                </g>
              )
            })}
        </svg>
        {tip && hotDay && (
          <div role="tooltip" data-tip="" className={`${TIP_CLASS} w-48`} style={{ left: `${tip.x}%`, top: `${tip.y}%`, transform: `translate(${tipLeft}, calc(-100% - 12px))` }}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium opacity-80">{fmtLong(hotDay.date)}</span>
              {hot === busiest && <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ background: acc(600) }}>Busiest</span>}
            </div>
            <div className="mt-1 text-lg font-semibold tabular-nums leading-none">{nf(hotDay.value)}</div>
            <div className="mb-1.5 mt-0.5 opacity-70">
              {unit}{dailyAvg > 0 ? ` · ${dec1(hotDay.value / dailyAvg)}× daily avg` : ''}
            </div>
            {shownParts.length > 0 && (
              <ul className="space-y-0.5">
                {shownParts.map((t, k) => (
                  <li key={t.name} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: acc(TIP_SHADES[k]) }} />
                      <span className="truncate">{t.name}</span>
                    </span>
                    <span className="tabular-nums">{nf(t.count)}</span>
                  </li>
                ))}
                {others > 0 && (
                  <li className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-surface opacity-50" />
                      Others
                    </span>
                    <span className="tabular-nums">{nf(others)}</span>
                  </li>
                )}
              </ul>
            )}
            {hotDay.note && <div className="mt-1.5 opacity-70">{hotDay.note}</div>}
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-foreground-muted">
        <span>{mode === '3d' ? 'Hover a bar for details · drag to rotate' : 'Hover a cell for details'}</span>
        <ActivityLegend />
      </div>
      <table className="sr-only">
        <caption>{summary}</caption>
        <thead>
          <tr>
            <th>Date</th>
            <th>{unit.charAt(0).toUpperCase() + unit.slice(1)}</th>
            {hasNotes && <th>Details</th>}
          </tr>
        </thead>
        <tbody>
          {days.map(d => (
            <tr key={d.date}>
              <td>{d.date}</td>
              <td>{d.value}</td>
              {hasNotes && <td>{d.note ?? ''}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
