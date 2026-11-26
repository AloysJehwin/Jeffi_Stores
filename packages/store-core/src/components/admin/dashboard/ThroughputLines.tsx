'use client'

import { useId } from 'react'
import type { DashboardActivity } from '../../../lib/dashboard/activity-types'
import { acc, fmtShort, GRID_LINE, linePath, NEUTRAL_LINE, nf, svgId, TIP_CLASS, useIndexNav } from './viz'

export interface ThroughputLinesProps {
  throughput: DashboardActivity['throughput']
  /** Shown as a "Backlog n" badge; left out when undefined. */
  backlog?: number
  /** Legend and tooltip names; `placed: null` draws the shipped line alone. */
  labels?: { shipped: string; placed: string | null }
  ariaLabel?: string
  emptyText?: string
  className?: string
}

const LABELS = { shipped: 'Shipped', placed: 'Placed' }

const W = 600
const H = 150
const PT = 10
const PB = 6

/** Weekly placed (dashed neutral) against shipped (accent), with a Backlog badge. */
export function ThroughputLines({ throughput, backlog, labels = LABELS, ariaLabel, emptyText = 'No weekly activity yet.', className = '' }: ThroughputLinesProps) {
  const id = svgId(useId())
  const { idx, setIdx, onKeyDown } = useIndexNav(throughput.length)
  const two = labels.placed != null
  const empty = throughput.length === 0 || throughput.every(t => !(two && t.placed) && !t.shipped)
  const max = Math.max(1, ...throughput.flatMap(t => (two ? [t.placed, t.shipped] : [t.shipped])))
  const x = (i: number) => (throughput.length <= 1 ? W / 2 : (i / (throughput.length - 1)) * W)
  const y = (v: number) => PT + (H - PT - PB) * (1 - v / max)
  const shipped = throughput.map((t, i): [number, number] => [x(i), y(t.shipped)])
  const placed = throughput.map((t, i): [number, number] => [x(i), y(t.placed)])
  const hot = idx != null ? throughput[idx] : null
  const left = idx != null ? (x(idx) / W) * 100 : 0
  return (
    <div className={className}>
      <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-foreground-muted">
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="h-0.5 w-3 rounded" style={{ background: acc(600) }} />
            {labels.shipped}
          </span>
          {two && (
            <span className="flex items-center gap-1">
              <span className="w-3 border-t border-dashed" style={{ borderColor: NEUTRAL_LINE }} />
              {labels.placed}
            </span>
          )}
        </span>
        {backlog != null && <span className="rounded-full bg-surface-secondary px-2 py-0.5 font-medium tabular-nums text-foreground-secondary">Backlog {nf(backlog)}</span>}
      </div>
      {empty ? (
        <p className="py-8 text-center text-xs text-foreground-muted">{emptyText}</p>
      ) : (
        <div className="relative" tabIndex={0} role="group" aria-label={`${ariaLabel ?? 'Weekly placed and shipped orders'}, ${throughput.length} weeks. Use arrow keys to inspect.`} onKeyDown={onKeyDown} onBlur={() => setIdx(null)} onPointerLeave={() => setIdx(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id={`tl-${id}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor={acc(500)} stopOpacity=".18" />
                <stop offset="1" stopColor={acc(500)} stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0, 0.5, 1].map(f => (
              <line key={f} x1="0" x2={W} y1={y(max * f)} y2={y(max * f)} stroke={GRID_LINE} strokeOpacity=".5" strokeDasharray={f ? '2 4' : undefined} vectorEffect="non-scaling-stroke" />
            ))}
            <path d={`${linePath(shipped)} L${x(throughput.length - 1)} ${H - PB} L${x(0)} ${H - PB} Z`} fill={`url(#tl-${id})`} />
            {two && <path data-line="placed" d={linePath(placed)} fill="none" stroke={NEUTRAL_LINE} strokeWidth="1.5" strokeDasharray="4 4" strokeOpacity=".7" vectorEffect="non-scaling-stroke" />}
            <path data-line="shipped" d={linePath(shipped)} fill="none" stroke={acc(600)} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            {idx != null && <line x1={x(idx)} x2={x(idx)} y1={PT} y2={H - PB} stroke={NEUTRAL_LINE} strokeOpacity=".5" vectorEffect="non-scaling-stroke" />}
          </svg>
          {hot && (
            <div role="tooltip" className={TIP_CLASS} style={{ left: `${left}%`, top: 0, transform: `translateX(${left > 65 ? '-105%' : '8%'})` }}>
              <div className="mb-1 font-medium opacity-70">Week of {fmtShort(hot.weekStart)}</div>
              <div className="flex justify-between gap-4">
                <span className="opacity-70">{labels.shipped}</span>
                <span className="font-semibold tabular-nums">{nf(hot.shipped)}</span>
              </div>
              {two && (
                <div className="flex justify-between gap-4">
                  <span className="opacity-70">{labels.placed}</span>
                  <span className="tabular-nums">{nf(hot.placed)}</span>
                </div>
              )}
            </div>
          )}
          <div className="absolute inset-0 flex">
            {throughput.map((t, i) => (
              <div key={t.weekStart} data-zone={i} className="h-full flex-1" onPointerEnter={() => setIdx(i)} />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-foreground-muted" aria-hidden="true">
            <span>{fmtShort(throughput[0].weekStart)}</span>
            <span>{fmtShort(throughput[throughput.length - 1].weekStart)}</span>
          </div>
        </div>
      )}
    </div>
  )
}
