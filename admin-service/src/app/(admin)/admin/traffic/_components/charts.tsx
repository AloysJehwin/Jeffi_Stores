'use client'

import { useState } from 'react'
import { Empty } from '@/components/admin/channels/ui'

// Plain SVG / div charts carried over from the old Traffic page (no chart library).

export const PALETTE = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ef4444', '#14b8a6', '#f97316', '#6366f1', '#84cc16', '#6b7280']

const tipStyle = { backgroundColor: '#1e2030', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.08)' }

/** Grouped vertical bars per bucket, one colour per series, hover tooltip. */
export function BarSeries({
  rows,
  series,
  label,
  height = 160,
  stacked,
}: {
  rows: Record<string, any>[]
  series: { key: string; label: string; color: string }[]
  label: (r: Record<string, any>) => string
  height?: number
  stacked?: boolean
}) {
  const [hover, setHover] = useState<number | null>(null)
  if (!rows.length || rows.every(r => series.every(s => !r[s.key]))) return <Empty msg="No activity in this period" />
  const max = Math.max(1, ...rows.map(r => (stacked ? series.reduce((a, s) => a + (r[s.key] || 0), 0) : Math.max(...series.map(s => r[s.key] || 0)))))
  const every = Math.ceil(rows.length / 12)
  return (
    <div className="space-y-2">
      <div className="flex items-end gap-1" style={{ height }}>
        {rows.map((r, i) => (
          <div key={i} className="flex-1 relative h-full flex items-end justify-center gap-0.5" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            {hover === i && (
              <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 z-10 text-[10px] rounded px-2 py-1.5 whitespace-nowrap pointer-events-none shadow-lg" style={tipStyle}>
                <div className="font-semibold">{label(r)}</div>
                {series.map(s => (
                  <div key={s.key}>
                    {s.label}: {(r[s.key] || 0).toLocaleString('en-IN')}
                  </div>
                ))}
              </div>
            )}
            {stacked ? (
              <div className="w-3/4 h-full flex flex-col-reverse">
                {series.map(s => (
                  <div key={s.key} style={{ height: `${((r[s.key] || 0) / max) * 100}%`, backgroundColor: s.color }} />
                ))}
              </div>
            ) : (
              series.map(s => (
                <div
                  key={s.key}
                  className="rounded-t"
                  style={{ width: `${70 / series.length}%`, height: `${Math.max((r[s.key] || 0) > 0 ? 2 : 0, ((r[s.key] || 0) / max) * 100)}%`, backgroundColor: s.color }}
                />
              ))
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-1">
        {rows.map((r, i) => (
          <div key={i} className="flex-1 text-center text-[9px] text-foreground-muted truncate">
            {i % every === 0 ? label(r) : ''}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-foreground-muted">
        {series.map(s => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm inline-block" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  )
}

export function Donut({ segments, size = 120 }: { segments: { label: string; value: number; color: string; sub?: string }[]; size?: number }) {
  const total = segments.reduce((s, x) => s + x.value, 0)
  if (total === 0) return <Empty msg="No sessions in this period" />
  const r = 40
  const circ = 2 * Math.PI * r
  let offset = 0
  return (
    <div className="flex flex-col items-center gap-3">
      <svg width={size} height={size} viewBox="0 0 100 100" className="-rotate-90">
        <circle cx={50} cy={50} r={r} fill="none" stroke="var(--color-surface-secondary)" strokeWidth={14} />
        {segments.map(seg => {
          const dash = (seg.value / total) * circ
          const el = (
            <circle key={seg.label} cx={50} cy={50} r={r} fill="none" stroke={seg.color} strokeWidth={14} strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-offset} />
          )
          offset += dash
          return el
        })}
      </svg>
      <div className="w-full space-y-1.5">
        {segments.map(seg => (
          <div key={seg.label} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1.5 text-foreground font-medium min-w-0">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
              <span className="truncate">{seg.label}</span>
            </span>
            <span className="text-foreground-muted tabular-nums whitespace-nowrap">
              {seg.value.toLocaleString('en-IN')} ({Math.round((seg.value / total) * 100)}%){seg.sub ? ` · ${seg.sub}` : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Horizontal bar list: label, value and a bar scaled to the largest value. */
export function HBars({ rows, color = 'rgba(132,204,22,0.6)', empty }: { rows: { key: string; label: React.ReactNode; value: number; right?: React.ReactNode }[]; color?: string; empty?: string }) {
  if (!rows.length) return <Empty msg={empty} />
  const max = Math.max(1, ...rows.map(r => r.value))
  return (
    <div className="space-y-2">
      {rows.map(r => (
        <div key={r.key}>
          <div className="flex items-center justify-between gap-2 text-xs mb-0.5">
            <span className="font-medium text-foreground truncate min-w-0">{r.label}</span>
            <span className="text-foreground-muted tabular-nums whitespace-nowrap">{r.right ?? r.value.toLocaleString('en-IN')}</span>
          </div>
          <div className="h-1.5 bg-surface-secondary rounded-full">
            <div className="h-full rounded-full" style={{ width: `${Math.round((r.value / max) * 100)}%`, backgroundColor: color }} />
          </div>
        </div>
      ))}
    </div>
  )
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Weekday x hour grid (ISO weekday 1 = Monday). */
export function Heatmap({ cells }: { cells: { dow: number; hour: number; views: number }[] }) {
  if (!cells.length) return <Empty msg="No page views in this period" />
  const by = new Map(cells.map(c => [`${c.dow}-${c.hour}`, c.views]))
  const max = Math.max(1, ...cells.map(c => c.views))
  return (
    <div className="relative">
      <div className="overflow-x-auto">
        <div className="min-w-[560px] space-y-1">
          {DAYS.map((d, i) => (
            <div key={d} className="flex items-center gap-1">
              <span className="w-8 text-[10px] text-foreground-muted">{d}</span>
              <div className="flex-1 grid gap-0.5" style={{ gridTemplateColumns: 'repeat(24,1fr)' }}>
                {Array.from({ length: 24 }, (_, h) => {
                  const v = by.get(`${i + 1}-${h}`) ?? 0
                  const a = v / max
                  return (
                    <div
                      key={h}
                      title={`${d} ${h}:00 · ${v} views`}
                      className="h-5 rounded-sm bg-surface-secondary"
                      style={v ? { backgroundColor: `rgba(132,204,22,${0.15 + a * 0.85})` } : undefined}
                    />
                  )
                })}
              </div>
            </div>
          ))}
          <div className="flex items-center gap-1">
            <span className="w-8" />
            <div className="flex-1 flex justify-between text-[9px] text-foreground-muted">
              {[0, 3, 6, 9, 12, 15, 18, 21].map(h => (
                <span key={h}>{h}:00</span>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="md:hidden pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-surface-elevated to-transparent" />
      <p className="md:hidden mt-2 text-[10px] text-foreground-muted text-right">Swipe for more hours →</p>
    </div>
  )
}
