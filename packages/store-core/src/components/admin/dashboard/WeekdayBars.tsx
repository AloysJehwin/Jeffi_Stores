'use client'

import { acc, dec1, fmtLong, NEUTRAL_LINE, usePrefersReducedMotion, useMounted, WEEKDAYS } from './viz'
import { SegmentedPills, type PillOption } from './SegmentedPills'

export interface WeekdayBarsProps {
  /** Mon..Sun of the current week. */
  days: { date: string; placed: number }[]
  /** Average placed per day over the last 8 weeks (dashed target line). */
  avg: number
  /** YYYY-MM-DD of today; that bar takes the accent. */
  today?: string
  channels?: PillOption[]
  channel?: string
  onChannelChange?: (value: string) => void
  className?: string
}

/** Mon–Sun placed counts: today in accent, the rest neutral, plus a dashed average line and optional channel chips. */
export function WeekdayBars({ days, avg, today, channels, channel, onChannelChange, className = '' }: WeekdayBarsProps) {
  const reduced = usePrefersReducedMotion()
  const mounted = useMounted(reduced)
  const scale = Math.max(1, avg, ...days.map(d => d.placed))
  const empty = days.every(d => d.placed === 0)
  return (
    <div className={className}>
      {channels && channels.length > 0 && onChannelChange && (
        <SegmentedPills size="sm" ariaLabel="Channel" options={channels} value={channel ?? channels[0].value} onChange={onChannelChange} className="mb-3" />
      )}
      <div className="relative">
        <div className="flex h-32 items-end gap-2">
          {days.map((d, i) => {
            const isToday = d.date === today
            return (
              <div key={d.date} className="flex h-full flex-1 flex-col items-center justify-end gap-1" role="img" aria-label={`${fmtLong(d.date)}: ${d.placed} placed${isToday ? ' (today)' : ''}`}>
                <span className="text-[11px] font-medium tabular-nums text-foreground-secondary">{d.placed}</span>
                <div
                  data-bar={isToday ? 'today' : 'day'}
                  className="w-full origin-bottom rounded-md"
                  style={{
                    height: `${Math.max(d.placed ? 4 : 2, (d.placed / scale) * 100 * 0.78)}%`,
                    background: isToday ? acc(500) : 'var(--color-border)',
                    opacity: d.placed ? 1 : 0.5,
                    transform: mounted ? 'scaleY(1)' : 'scaleY(0)',
                    transition: reduced ? undefined : `transform 450ms cubic-bezier(0.23,1,0.32,1) ${i * 30}ms`,
                  }}
                />
              </div>
            )
          })}
        </div>
        {!empty && avg > 0 && (
          <div data-avg-line="" className="pointer-events-none absolute inset-x-0" style={{ bottom: `calc(${(avg / scale) * 78}% + 1.25rem)` }}>
            <div className="border-t border-dashed" style={{ borderColor: NEUTRAL_LINE }} />
            <span className="absolute -top-2.5 right-0 rounded bg-foreground px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-surface">Avg {dec1(avg)}</span>
          </div>
        )}
      </div>
      <div className="mt-1.5 flex gap-2 text-center text-[11px] text-foreground-muted">
        {days.map((d, i) => (
          <span key={d.date} className={`flex-1 ${d.date === today ? 'font-semibold text-foreground' : ''}`}>
            {WEEKDAYS[i] ?? ''}
          </span>
        ))}
      </div>
      {empty && <p className="mt-2 text-center text-xs text-foreground-muted">No orders placed this week yet.</p>}
    </div>
  )
}
