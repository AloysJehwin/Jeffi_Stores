'use client'

import type { DashboardSeries } from '../../../lib/dashboard/activity-types'
import { acc, nf, usePrefersReducedMotion, useMounted } from './viz'

export interface FlowStreamProps {
  flow: DashboardSeries['flow']
  className?: string
}

const W = 600
const H = 120
const MAXH = 96

/** Placed → Paid → Shipped → Delivered bands sized by count, with cancelled/returned shown as leaks. */
export function FlowStream({ flow, className = '' }: FlowStreamProps) {
  const reduced = usePrefersReducedMotion()
  const mounted = useMounted(reduced)
  if (!flow.placed) return <p className="py-10 text-center text-xs text-foreground-muted">No orders placed in this range.</p>
  const stages = [
    { key: 'placed', label: 'Placed', n: flow.placed },
    { key: 'paid', label: 'Paid', n: flow.paid },
    { key: 'shipped', label: 'Shipped', n: flow.shipped },
    { key: 'delivered', label: 'Delivered', n: flow.delivered },
  ]
  const xs = stages.map((_, i) => 40 + (i * (W - 80)) / (stages.length - 1))
  const hs = stages.map(s => (s.n > 0 ? Math.max(5, (s.n / flow.placed) * MAXH) : 0))
  const cy = H / 2
  return (
    <div className={className}>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" aria-hidden="true">
          <g style={{ transformOrigin: '0 50%', transformBox: 'fill-box', transform: mounted ? 'scaleX(1)' : 'scaleX(0)', transition: reduced ? undefined : 'transform 600ms cubic-bezier(0.23,1,0.32,1)' }}>
            {stages.slice(0, -1).map((_, i) => (
              <path
                key={i}
                data-band={stages[i + 1].key}
                d={`M${xs[i]} ${cy - hs[i] / 2} C${(xs[i] + xs[i + 1]) / 2} ${cy - hs[i] / 2} ${(xs[i] + xs[i + 1]) / 2} ${cy - hs[i + 1] / 2} ${xs[i + 1]} ${cy - hs[i + 1] / 2} L${xs[i + 1]} ${cy + hs[i + 1] / 2} C${(xs[i] + xs[i + 1]) / 2} ${cy + hs[i + 1] / 2} ${(xs[i] + xs[i + 1]) / 2} ${cy + hs[i] / 2} ${xs[i]} ${cy + hs[i] / 2} Z`}
                fill={acc(500, 0.38 - i * 0.09)}
              />
            ))}
            {stages.map((s, i) => (
              <rect key={s.key} x={xs[i] - 2} y={cy - hs[i] / 2} width="4" height={hs[i]} rx="2" fill={acc(600)} />
            ))}
          </g>
        </svg>
        {stages.map((s, i) => (
          <span key={s.key} className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-surface-elevated px-2 py-0.5 text-xs font-semibold tabular-nums text-foreground shadow-[0_0_0_1px_rgba(0,0,0,.08),0_1px_3px_rgba(0,0,0,.08)] dark:shadow-[0_0_0_1px_rgba(255,255,255,.14)]" style={{ left: `${(xs[i] / W) * 100}%`, top: '50%' }}>
            {nf(s.n)}
          </span>
        ))}
      </div>
      <div className="relative mt-2 h-4 text-[11px] text-foreground-muted">
        {stages.map((s, i) => (
          <span key={s.key} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${(xs[i] / W) * 100}%` }}>
            {s.label}
            <span className="ml-1 tabular-nums opacity-70">{Math.round((s.n / flow.placed) * 100)}%</span>
          </span>
        ))}
      </div>
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-foreground-muted">
        <span>Cancelled <b className="font-semibold tabular-nums text-foreground-secondary">{nf(flow.cancelled)}</b></span>
        <span>Returned <b className="font-semibold tabular-nums text-foreground-secondary">{nf(flow.returned)}</b></span>
      </p>
    </div>
  )
}
