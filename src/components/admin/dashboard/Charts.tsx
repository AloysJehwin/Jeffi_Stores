'use client'

/**
 * Hand-rolled SVG revenue trend chart (area + line) — no chart library, matching
 * the codebase's inline-SVG convention. Renders a smooth-ish polyline over an
 * area gradient with hover tooltips per point.
 */
export function TrendChart({ points, height = 160 }: {
  points: { label: string; revenue: number; orders: number }[]
  height?: number
}) {
  if (!points.length) {
    return <div className="flex items-center justify-center text-xs text-foreground-muted" style={{ height }}>No data in this range</div>
  }

  const W = 640
  const H = height
  const padX = 8
  const padY = 12
  const maxRev = Math.max(1, ...points.map(p => p.revenue))
  const n = points.length
  const x = (i: number) => padX + (n === 1 ? (W - padX * 2) / 2 : (i / (n - 1)) * (W - padX * 2))
  const y = (v: number) => padY + (1 - v / maxRev) * (H - padY * 2)

  const linePts = points.map((p, i) => `${x(i)},${y(p.revenue)}`).join(' ')
  const areaPts = `${x(0)},${H - padY} ${linePts} ${x(n - 1)},${H - padY}`

  const fmtDate = (iso: string) => {
    const d = new Date(iso)
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  }

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} preserveAspectRatio="none">
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(16 185 129)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="rgb(16 185 129)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={areaPts} fill="url(#trendFill)" />
        <polyline points={linePts} fill="none" stroke="rgb(16 185 129)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(p.revenue)} r={2.5} fill="rgb(16 185 129)" />
            <rect x={x(i) - (W / n) / 2} y={0} width={(W / n)} height={H} fill="transparent">
              <title>{`${fmtDate(p.label)}: Rs ${Math.round(p.revenue).toLocaleString('en-IN')} · ${p.orders} orders`}</title>
            </rect>
          </g>
        ))}
      </svg>
      <div className="flex justify-between text-[10px] text-foreground-muted mt-1 px-1">
        <span>{fmtDate(points[0].label)}</span>
        {points.length > 2 && <span>{fmtDate(points[Math.floor(n / 2)].label)}</span>}
        <span>{fmtDate(points[n - 1].label)}</span>
      </div>
    </div>
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
