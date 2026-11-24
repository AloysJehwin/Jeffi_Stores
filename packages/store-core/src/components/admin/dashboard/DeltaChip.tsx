'use client'

export interface DeltaChipProps {
  /** Percent change; null/undefined renders a neutral dash. */
  value: number | null | undefined
  /** Lower is better (returns, RTO): flips the colour. */
  invert?: boolean
  className?: string
}

/** 11px pill: up green, down red, flat/unknown neutral. */
export function DeltaChip({ value, invert = false, className = '' }: DeltaChipProps) {
  const known = value != null && isFinite(value)
  const v = known ? (value as number) : 0
  const dir = !known || Math.abs(v) < 0.05 ? 0 : v > 0 ? 1 : -1
  const good = dir === 0 ? null : invert ? dir < 0 : dir > 0
  const tone =
    good == null
      ? 'bg-surface-secondary text-foreground-muted'
      : good
        ? 'bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-400'
        : 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-400'
  const text = !known ? '–' : `${dir > 0 ? '↑ ' : dir < 0 ? '↓ ' : ''}${Math.abs(v).toFixed(1)}%`
  const label = !known ? 'No change data' : dir === 0 ? 'No change' : `${dir > 0 ? 'Up' : 'Down'} ${Math.abs(v).toFixed(1)} percent`
  return (
    <span role="status" aria-label={label} data-tone={good == null ? 'neutral' : good ? 'good' : 'bad'} className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${tone} ${className}`}>
      {text}
    </span>
  )
}
