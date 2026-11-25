'use client'

import { SegmentedPills, type PillOption } from './SegmentedPills'
import { DeltaChip } from './DeltaChip'

export interface Metric {
  label: string
  /** Pre-formatted value ("2.4 d", "92%"). */
  value: string
  hint?: string
  /** Percent change vs the previous period, if known. */
  delta?: number | null
  /** Lower is better (RTO, returns): flips the chip colour. */
  invertDelta?: boolean
}

export interface MetricListProps {
  metrics: Metric[]
  tabs?: PillOption[]
  tab?: string
  onTabChange?: (value: string) => void
  className?: string
}

/** Label / value rows with optional tabs (All / Online / COD) and delta chips. */
export function MetricList({ metrics, tabs, tab, onTabChange, className = '' }: MetricListProps) {
  return (
    <div className={className}>
      {tabs && tabs.length > 0 && onTabChange && <SegmentedPills size="sm" ariaLabel="Channel" options={tabs} value={tab ?? tabs[0].value} onChange={onTabChange} className="mb-2" />}
      {metrics.length === 0 ? (
        <p className="py-6 text-center text-xs text-foreground-muted">No fulfilment data yet.</p>
      ) : (
        <dl className="divide-y divide-border-default">
          {metrics.map(m => (
            <div key={m.label} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <dt className="text-xs font-medium text-foreground-secondary">{m.label}</dt>
                {m.hint && <p className="text-[11px] text-foreground-muted">{m.hint}</p>}
              </div>
              <dd className="flex shrink-0 items-center gap-2">
                {m.delta !== undefined && <DeltaChip value={m.delta} invert={m.invertDelta} />}
                <span className="text-lg font-semibold tabular-nums text-foreground">{m.value}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
