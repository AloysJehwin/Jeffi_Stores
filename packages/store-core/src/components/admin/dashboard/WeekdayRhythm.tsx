'use client'

import { acc, dec1, usePrefersReducedMotion, useMounted, WEEKDAYS, WEEKDAYS_LONG } from './viz'

export interface WeekdayRhythmProps {
  /** 0 = Mon … 6 = Sun. */
  weekday: { day: number; avg: number }[]
  /** Word in each bar's label: "Monday: 4 shipped per day on average". */
  unit?: string
  emptyText?: string
  className?: string
}

/** Average shipped per weekday, value above each bar, peak day in accent. */
export function WeekdayRhythm({ weekday, unit = 'shipped', emptyText = 'No shipments yet.', className = '' }: WeekdayRhythmProps) {
  const reduced = usePrefersReducedMotion()
  const mounted = useMounted(reduced)
  const byDay = Array.from({ length: 7 }, (_, d) => weekday.find(w => w.day === d)?.avg ?? 0)
  const max = Math.max(...byDay)
  if (max <= 0) return <p className={`py-6 text-center text-xs text-foreground-muted ${className}`}>{emptyText}</p>
  const peak = byDay.indexOf(max)
  const weekend = (byDay[5] + byDay[6]) / 2
  return (
    <div className={className}>
      <div className="flex h-24 items-end gap-1.5">
        {byDay.map((v, d) => (
          <div key={d} className="flex h-full flex-1 flex-col items-center justify-end gap-1" role="img" aria-label={`${WEEKDAYS_LONG[d]}: ${dec1(v)} ${unit} per day on average`}>
            <span className="text-[10px] tabular-nums text-foreground-secondary">{dec1(v)}</span>
            <div
              data-bar={d === peak ? 'peak' : 'day'}
              className="w-full origin-bottom rounded-md"
              style={{
                height: `${Math.max(v ? 4 : 2, (v / max) * 72)}%`,
                background: d === peak ? acc(500) : 'var(--color-border)',
                transform: mounted ? 'scaleY(1)' : 'scaleY(0)',
                transition: reduced ? undefined : `transform 450ms cubic-bezier(0.23,1,0.32,1) ${d * 25}ms`,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1.5 text-center text-[10px] text-foreground-muted">
        {WEEKDAYS.map(d => (
          <span key={d} className="flex-1">
            {d.slice(0, 1)}
          </span>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-foreground-muted">
        {WEEKDAYS[peak]} peak · weekends {dec1(weekend)}
      </p>
    </div>
  )
}
