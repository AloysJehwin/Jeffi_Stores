'use client'

import { CompactStat, pctStr, numStr, daysStr } from '@/components/admin/dashboard/Primitives'
import type { Growth, CohortRow } from '@/lib/crm-insights-shared'

function cohortLabel(iso: string): string {
  const d = new Date(`${iso}-01T00:00:00`)
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
}

function cellStyle(pct: number | null): { background: string; color: string } {
  if (pct == null) return { background: 'transparent', color: 'inherit' }
  const alpha = Math.max(0.08, Math.min(0.9, pct / 100))
  return { background: `rgb(16 185 129 / ${alpha})`, color: alpha > 0.55 ? '#fff' : 'inherit' }
}

function CohortGrid({ rows }: { rows: CohortRow[] }) {
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-xs border-separate border-spacing-1">
        <thead>
          <tr>
            <th className="text-left font-medium text-foreground-muted px-1 py-1">Cohort</th>
            <th className="text-right font-medium text-foreground-muted px-1 py-1">Size</th>
            {[0, 1, 2, 3, 4, 5].map(m => (
              <th key={m} className="text-center font-medium text-foreground-muted px-1 py-1 tabular-nums">
                M{m}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.cohort}>
              <td className="text-foreground-secondary px-1 py-1 whitespace-nowrap">{cohortLabel(r.cohort)}</td>
              <td className="text-right text-foreground px-1 py-1 tabular-nums">{numStr(r.size)}</td>
              {r.retention.map((pct, m) => (
                <td key={m} className="text-center px-1 py-1 tabular-nums rounded" style={cellStyle(pct)}>
                  {pct == null ? '' : `${Math.round(pct)}%`}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function GrowthRetentionCard({ growth, cohorts }: { growth: Growth; cohorts: CohortRow[] }) {
  const empty = growth.buyers === 0 && growth.newCustomers === 0 && cohorts.length === 0
  if (empty) return null

  return (
    <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
      <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest mb-4">
        Growth and Retention
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
        <CompactStat label="New customers" value={numStr(growth.newCustomers)} />
        <CompactStat label="Returning buyers" value={numStr(growth.returningCustomers)} />
        <CompactStat
          label="Repeat rate"
          value={pctStr(growth.repeatRate, 0)}
          sub={`${numStr(growth.repeatBuyers)} of ${numStr(growth.buyers)} buyers`}
        />
        <CompactStat label="Median to 2nd order" value={daysStr(growth.medianDaysToSecond)} />
        <CompactStat label="Buyers in range" value={numStr(growth.buyers)} />
        <CompactStat label="Churned" value={numStr(growth.churned)} />
      </div>
      {cohorts.length > 0 && (
        <>
          <p className="text-[11px] uppercase tracking-wide text-foreground-muted font-medium mb-2">
            Monthly retention by cohort
          </p>
          <CohortGrid rows={cohorts} />
        </>
      )}
    </div>
  )
}
