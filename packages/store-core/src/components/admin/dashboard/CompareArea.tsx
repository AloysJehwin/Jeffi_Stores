'use client'

import { useId } from 'react'
import { acc, linePath, nf, pctChange, svgId, TIP_CLASS, useIndexNav, NEUTRAL_LINE, GRID_LINE } from './viz'

export interface ComparePoint {
  label: string
  current: number
  previous: number
}

export interface CompareAreaProps {
  points: ComparePoint[]
  format?: (n: number) => string
  currentLabel?: string
  previousLabel?: string
  className?: string
}

const W = 600
const H = 190
const PT = 10
const PB = 8

/** This period (accent line + fading area) against the previous one (neutral dashed), with a hover guide and card. */
export function CompareArea({ points, format = nf, currentLabel = 'This period', previousLabel = 'Previous', className = '' }: CompareAreaProps) {
  const id = svgId(useId())
  const { idx, setIdx, onKeyDown } = useIndexNav(points.length)
  if (points.length === 0 || points.every(p => !p.current && !p.previous)) {
    return <p className="py-10 text-center text-xs text-foreground-muted">No data in this range.</p>
  }
  const max = Math.max(1, ...points.flatMap(p => [p.current, p.previous]))
  const x = (i: number) => (points.length <= 1 ? W / 2 : (i / (points.length - 1)) * W)
  const y = (v: number) => PT + (H - PT - PB) * (1 - v / max)
  const cur = points.map((p, i): [number, number] => [x(i), y(p.current)])
  const prev = points.map((p, i): [number, number] => [x(i), y(p.previous)])
  const hot = idx != null ? points[idx] : null
  const change = hot ? pctChange(hot.current, hot.previous) : null
  const left = idx != null ? (x(idx) / W) * 100 : 0
  return (
    <div
      className={`relative ${className}`}
      tabIndex={0}
      role="group"
      aria-label={`${currentLabel} against ${previousLabel}, ${points.length} points. Use arrow keys to inspect.`}
      onKeyDown={onKeyDown}
      onBlur={() => setIdx(null)}
      onPointerLeave={() => setIdx(null)}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={`ca-${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={acc(500)} stopOpacity=".18" />
            <stop offset="1" stopColor={acc(500)} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map(f => (
          <line key={f} x1="0" x2={W} y1={y(max * f)} y2={y(max * f)} stroke={GRID_LINE} strokeOpacity=".5" strokeDasharray={f ? '2 4' : undefined} vectorEffect="non-scaling-stroke" />
        ))}
        <path data-line="previous" d={linePath(prev)} fill="none" stroke={NEUTRAL_LINE} strokeWidth="1.5" strokeDasharray="4 4" strokeOpacity=".7" vectorEffect="non-scaling-stroke" />
        <path d={`${linePath(cur)} L${x(points.length - 1)} ${H - PB} L${x(0)} ${H - PB} Z`} fill={`url(#ca-${id})`} />
        <path data-line="current" d={linePath(cur)} fill="none" stroke={acc(600)} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {idx != null && (
          <line data-guide="" x1={x(idx)} x2={x(idx)} y1={PT} y2={H - PB} stroke={NEUTRAL_LINE} strokeOpacity=".5" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {idx != null && (
        <>
          <span className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface-elevated" style={{ left: `${left}%`, top: `${(y(points[idx].current) / H) * 100}%`, background: acc(600) }} />
          <div role="tooltip" className={TIP_CLASS} style={{ left: `${left}%`, top: 0, transform: `translateX(${left > 65 ? '-105%' : '8%'})` }}>
            <div className="mb-1 font-medium opacity-70">{hot!.label}</div>
            <div className="flex items-center justify-between gap-4">
              <span className="opacity-70">{currentLabel}</span>
              <span className="font-semibold tabular-nums">{format(hot!.current)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="opacity-70">{previousLabel}</span>
              <span className="tabular-nums">{format(hot!.previous)}</span>
            </div>
            <div className="mt-1 text-right font-semibold tabular-nums">{change == null ? '–' : `${change > 0 ? '+' : ''}${change.toFixed(1)}%`}</div>
          </div>
        </>
      )}
      <div className="absolute inset-0 flex">
        {points.map((p, i) => (
          <div key={i} data-zone={i} className="h-full flex-1" onPointerEnter={() => setIdx(i)} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-foreground-muted tabular-nums" aria-hidden="true">
        <span>{points[0].label}</span>
        {points.length > 2 && <span>{points[Math.floor((points.length - 1) / 2)].label}</span>}
        <span>{points[points.length - 1].label}</span>
      </div>
    </div>
  )
}
