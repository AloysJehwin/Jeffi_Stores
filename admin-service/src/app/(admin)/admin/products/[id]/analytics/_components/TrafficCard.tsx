'use client'

import { useState } from 'react'
import { ChartCard } from '@/components/admin/kit'
import { GRANULARITIES, aggregate, fmtLabel, type Granularity, type TrafficRow } from './analytics'

const SERIES = [
  { key: 'views', legend: 'Views', unit: 'views', bar: 'bg-blue-500', count: 'text-foreground' },
  { key: 'carts', legend: 'Cart adds', unit: 'cart adds', bar: 'bg-amber-400', count: 'text-amber-500 dark:text-amber-400' },
  { key: 'orders', legend: 'Orders', unit: 'orders', bar: 'bg-green-500', count: 'text-green-600 dark:text-green-400 font-semibold' },
] as const

/** Views, cart adds and orders per day / week / month as stacked mini bars. */
export function TrafficCard({ series }: { series: TrafficRow[] }) {
  const [granularity, setGranularity] = useState<Granularity>('daily')
  const [showZeros, setShowZeros] = useState(false)

  const aggregated = aggregate(series, granularity)
  const total = (r: TrafficRow) => r.views + r.carts + r.orders
  const hasZeros = aggregated.some(r => total(r) === 0)
  const displayed = showZeros ? aggregated : aggregated.filter(r => total(r) > 0)
  const max = { views: Math.max(...displayed.map(d => d.views), 1), carts: Math.max(...displayed.map(d => d.carts), 1), orders: Math.max(...displayed.map(d => d.orders), 1) }
  const showAll = `Show all ${aggregated.length} ${GRANULARITIES.find(g => g.id === granularity)!.plural}`

  return (
    <ChartCard
      title="Traffic"
      action={
        <div className="inline-flex h-control items-center gap-0.5 rounded-lg bg-surface-secondary p-0.5">
          {GRANULARITIES.map(g => (
            <button
              key={g.id}
              onClick={() => setGranularity(g.id)}
              aria-pressed={granularity === g.id}
              className={`h-full rounded-md px-2.5 text-xs font-medium transition-colors ${
                granularity === g.id ? 'bg-surface-elevated text-foreground shadow' : 'text-foreground-muted hover:text-foreground'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      }
    >
      {displayed.length === 0 ? (
        <p className="py-2 text-sm text-foreground-muted">
          No activity in this range.{' '}
          {hasZeros && (
            <button onClick={() => setShowZeros(true)} className="underline transition-colors hover:text-foreground">
              {showAll}
            </button>
          )}
        </p>
      ) : (
        <div className="space-y-3">
          {displayed.map(d => (
            <div key={d.date} className="flex items-center gap-3 text-xs">
              <span className={`shrink-0 text-foreground-muted ${granularity === 'weekly' ? 'w-32' : 'w-20'}`}>{fmtLabel(d.date, granularity)}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                {SERIES.map(s => (
                  <div key={s.key} className="flex h-2.5 items-center gap-1">
                    <div
                      className={`${s.bar} h-full rounded-sm transition-all`}
                      style={{ width: `${(d[s.key] / max[s.key]) * 100}%`, minWidth: d[s.key] > 0 ? '2px' : '0' }}
                      title={`${d[s.key]} ${s.unit}`}
                    />
                    <span className={`w-6 shrink-0 text-[10px] tabular-nums ${s.count}`}>{d[s.key]}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border-default pt-3 text-xs text-foreground-muted">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {SERIES.map(s => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span className={`inline-block h-2.5 w-3 rounded-sm ${s.bar}`} /> {s.legend}
            </span>
          ))}
        </div>
        {hasZeros && (
          <button onClick={() => setShowZeros(v => !v)} className="font-medium text-accent-500 transition-colors hover:text-accent-600">
            {showZeros ? 'Hide zero days' : showAll}
          </button>
        )}
      </div>
    </ChartCard>
  )
}
