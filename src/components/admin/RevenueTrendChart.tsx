'use client'

import { useState } from 'react'
import type { RevenueTrend } from '@/lib/queries'
import AdminSelect from '@/components/admin/AdminSelect'

// Hand-rolled inline-SVG multi-line chart (no charting library — matches the house style in
// TrafficClient.tsx). One line per order source, with a period selector, legend, and a hover
// tooltip showing per-source revenue for the hovered month.

const VIEW_W = 560
const VIEW_H = 140
// Tight padding so the lines use as much width as possible (left just clears the Y labels).
const PAD = { top: 10, right: 8, bottom: 20, left: 34 }

const PERIODS: { value: string; label: string }[] = [
  { value: '3m', label: '3 Months' },
  { value: '6m', label: '6 Months' },
  { value: '12m', label: '12 Months' },
  { value: 'ytd', label: 'This Year' },
  { value: 'all', label: 'All Time' },
]

function formatINR(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`
}

function shortMonth(m: string): string {
  if (!m) return ''
  const [y, mm] = m.split('-')
  const d = new Date(Number(y), Number(mm) - 1, 1)
  return d.toLocaleDateString('en-IN', { month: 'short' })
}

export default function RevenueTrendChart({ data: initial }: { data: RevenueTrend }) {
  const [data, setData] = useState<RevenueTrend>(initial)
  const [period, setPeriod] = useState('12m')
  const [loading, setLoading] = useState(false)
  const [hover, setHover] = useState<number | null>(null)

  const { months, series } = data
  const activeSeries = series.filter(s => s.points.some(p => p > 0))
  const hasData = months.length > 0 && activeSeries.length > 0

  const maxY = Math.max(1, ...series.flatMap(s => s.points))
  const plotW = VIEW_W - PAD.left - PAD.right
  const plotH = VIEW_H - PAD.top - PAD.bottom

  const x = (i: number) => PAD.left + (months.length <= 1 ? plotW / 2 : (i / (months.length - 1)) * plotW)
  const y = (v: number) => PAD.top + plotH - (v / maxY) * plotH
  const yTicks = [0, maxY / 2, maxY]
  // Label every month when few, else thin them out to avoid crowding.
  const xStep = months.length <= 8 ? 1 : Math.ceil(months.length / 7)

  async function changePeriod(p: string) {
    setPeriod(p)
    setLoading(true)
    setHover(null)
    try {
      const res = await fetch(`/api/admin/orders/revenue-trend?period=${p}`)
      if (res.ok) {
        const json = await res.json()
        if (json.trend) setData(json.trend)
      }
    } catch {
      /* keep previous data on failure */
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-surface-elevated border border-border-default rounded-lg shadow-sm p-4 h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between mb-2 flex-shrink-0 gap-2">
        <p className="text-sm font-semibold text-foreground">Revenue Trend</p>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-foreground-muted hidden sm:inline">by source ·</span>
          <AdminSelect
            xs
            value={period}
            options={PERIODS}
            onChange={changePeriod}
            disabled={loading}
            className="w-28"
          />
        </div>
      </div>

      {!hasData ? (
        <div className="flex-1 flex items-center justify-center text-sm text-foreground-muted">
          {loading ? 'Loading…' : 'No revenue data yet'}
        </div>
      ) : (
        <>
          <div className={`relative flex-1 min-h-0 transition-opacity ${loading ? 'opacity-50' : ''}`}>
            <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="w-full h-full" preserveAspectRatio="none">
              {yTicks.map((t, i) => (
                <g key={i}>
                  <line
                    x1={PAD.left}
                    x2={VIEW_W - PAD.right}
                    y1={y(t)}
                    y2={y(t)}
                    className="stroke-border-default"
                    strokeWidth={1}
                    strokeDasharray={i === 0 ? undefined : '3 3'}
                  />
                  <text x={PAD.left - 4} y={y(t) + 3} textAnchor="end" className="fill-foreground-muted" fontSize={9}>
                    {t >= 1000 ? `${Math.round(t / 1000)}k` : Math.round(t)}
                  </text>
                </g>
              ))}

              {months.map(
                (m, i) =>
                  (i % xStep === 0 || i === months.length - 1) && (
                    <text
                      key={m}
                      x={x(i)}
                      y={VIEW_H - 6}
                      textAnchor="middle"
                      className="fill-foreground-muted"
                      fontSize={9}
                    >
                      {shortMonth(m)}
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

              {activeSeries.map(s => (
                <g key={s.source}>
                  <polyline
                    fill="none"
                    stroke={s.color}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    points={s.points.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
                  />
                  {s.points.map((v, i) => (
                    <circle key={i} cx={x(i)} cy={y(v)} r={hover === i ? 3.5 : 2} fill={s.color} />
                  ))}
                </g>
              ))}

              {months.map((m, i) => (
                <rect
                  key={m}
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
                className="absolute z-10 text-[11px] rounded px-2.5 py-2 shadow-lg pointer-events-none"
                style={{
                  backgroundColor: '#1e2030',
                  color: '#e2e8f0',
                  border: '1px solid rgba(255,255,255,0.08)',
                  left: `${(x(hover) / VIEW_W) * 100}%`,
                  top: 0,
                  transform: 'translateX(-50%)',
                }}
              >
                <div className="font-semibold mb-1">
                  {shortMonth(months[hover])} {months[hover].split('-')[0]}
                </div>
                {activeSeries.map(s => (
                  <div key={s.source} className="flex items-center gap-1.5 whitespace-nowrap">
                    <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                    <span style={{ color: 'rgba(148,163,184,0.9)' }}>{s.label}</span>
                    <span className="ml-auto font-medium">{formatINR(s.points[hover])}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 flex-shrink-0">
            {activeSeries.map(s => (
              <div key={s.source} className="flex items-center gap-1.5 text-xs text-foreground-secondary">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                {s.label}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
