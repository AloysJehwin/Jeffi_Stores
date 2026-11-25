'use client'

import { useState } from 'react'
import type { ActivityDay } from '../../../lib/dashboard/activity-types'
import { dotFill, fmtLong, fmtMonth, GRID_LINE, LEVEL_SHADES, acc, NEUTRAL_FILL, TIP_CLASS } from './viz'

export interface DotCalendarProps {
  days: ActivityDay[]
  className?: string
}

const CELL = 10

/** "Less ○○○○ More" legend shared with the 3D chart. */
export function ActivityLegend({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] text-foreground-muted ${className}`} aria-hidden="true">
      Less
      <svg width={LEVEL_SHADES.length * 11 + 11} height="10">
        <circle cx="5" cy="5" r="4" fill={NEUTRAL_FILL} stroke={GRID_LINE} strokeWidth=".5" />
        {LEVEL_SHADES.map((s, i) => (
          <circle key={s} cx={16 + i * 11} cy="5" r="4" fill={acc(s)} />
        ))}
      </svg>
      More
    </span>
  )
}

/** Weeks × weekdays grid of dots, shaded by shipped count. Hover shows the day. */
export function DotCalendar({ days, className = '' }: DotCalendarProps) {
  const [hot, setHot] = useState<number | null>(null)
  const weeks = Math.ceil(days.length / 7)
  if (!days.length) return <p className="py-6 text-center text-xs text-foreground-muted">No shipments yet.</p>
  const max = Math.max(1, ...days.map(d => d.shipped))
  const months: { w: number; label: string }[] = []
  for (let w = 0; w < weeks; w++) {
    const d = days[w * 7]
    if (!d) continue
    const m = fmtMonth(d.date)
    if (!months.length || months[months.length - 1].label !== m) months.push({ w, label: m })
  }
  const hotDay = hot != null ? days[hot] : null
  const hw = hot != null ? Math.floor(hot / 7) : 0
  return (
    <div className={className}>
      <div className="relative mb-1 h-3 text-[10px] text-foreground-muted" aria-hidden="true">
        {months.map(m => (
          <span key={`${m.w}-${m.label}`} className="absolute" style={{ left: `${(m.w / weeks) * 100}%` }}>
            {m.label}
          </span>
        ))}
      </div>
      <div className="relative" onPointerLeave={() => setHot(null)}>
        <svg viewBox={`0 0 ${weeks * CELL} ${7 * CELL}`} className="block h-auto w-full" role="img" aria-label={`Orders shipped per day over ${weeks} weeks`}>
          {days.map((d, i) => (
            <circle
              key={d.date}
              data-dot={i}
              data-level={d.shipped > 0 ? 1 : 0}
              cx={Math.floor(i / 7) * CELL + CELL / 2}
              cy={(i % 7) * CELL + CELL / 2}
              r={hot === i ? CELL * 0.46 : CELL * 0.36}
              fill={dotFill(d.shipped, max)}
              stroke={d.shipped > 0 ? undefined : GRID_LINE}
              strokeWidth={d.shipped > 0 ? 0 : 0.4}
              onPointerEnter={() => setHot(i)}
              style={{ transition: 'r 150ms' }}
            />
          ))}
        </svg>
        {hotDay && (
          <div role="tooltip" className={TIP_CLASS} style={{ left: `${((hw + 0.5) / weeks) * 100}%`, top: `${(((hot as number) % 7) / 7) * 100}%`, transform: `translate(${hw > weeks * 0.6 ? '-110%' : '10%'}, -110%)` }}>
            <div className="opacity-70">{fmtLong(hotDay.date)}</div>
            <div className="font-semibold tabular-nums">{hotDay.shipped} shipped</div>
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-foreground-muted">
        <span>Mon – Sun, top to bottom</span>
        <ActivityLegend />
      </div>
    </div>
  )
}
