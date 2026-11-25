'use client'

import type { DashboardActivity } from '../../../lib/dashboard/activity-types'
import { acc, dec1, nf } from './viz'

export interface ProductShippedTableProps {
  products: DashboardActivity['topProducts']
  className?: string
}

function MiniBars({ values }: { values: number[] }) {
  const max = Math.max(1, ...values)
  const last = values.length - 1
  return (
    <span className="inline-flex h-5 items-end gap-0.5" role="img" aria-label={`Last ${values.length} weeks: ${values.join(', ')}`}>
      {values.map((v, i) => (
        <span key={i} data-mini="" className="w-1 rounded-sm" style={{ height: `${Math.max(v ? 15 : 8, (v / max) * 100)}%`, background: i === last ? acc(500) : 'var(--color-border)' }} />
      ))}
    </span>
  )
}

/** Top products shipped: shipped, on-time %, average days and the last 8 weeks as mini bars. */
export function ProductShippedTable({ products, className = '' }: ProductShippedTableProps) {
  if (products.length === 0) return <p className={`py-6 text-center text-xs text-foreground-muted ${className}`}>No products shipped in this range.</p>
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full min-w-[420px] text-xs">
        <thead>
          <tr className="text-left text-[11px] font-medium text-foreground-muted">
            <th scope="col" className="pb-2 pr-2 font-medium">Product</th>
            <th scope="col" className="pb-2 px-2 text-right font-medium">Shipped</th>
            <th scope="col" className="pb-2 px-2 text-right font-medium">On-time</th>
            <th scope="col" className="pb-2 px-2 text-right font-medium">Avg days</th>
            <th scope="col" className="pb-2 pl-2 text-right font-medium">Last 8 wks</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-default">
          {products.map(p => (
            <tr key={p.id}>
              <td className="max-w-[10rem] truncate py-2 pr-2 font-medium text-foreground" title={p.name}>{p.name}</td>
              <td className="px-2 py-2 text-right tabular-nums text-foreground">{nf(p.shipped)}</td>
              <td className="px-2 py-2 text-right tabular-nums text-foreground-secondary">{p.onTimePct == null ? '–' : `${Math.round(p.onTimePct)}%`}</td>
              <td className="px-2 py-2 text-right tabular-nums text-foreground-secondary">{p.avgDays == null ? '–' : `${dec1(p.avgDays)}d`}</td>
              <td className="py-2 pl-2 text-right">
                <MiniBars values={p.weekly} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
