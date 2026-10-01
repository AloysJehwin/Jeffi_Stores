'use client'

import Link from 'next/link'
import { ap } from '@/lib/shared/admin-path'
import { CompactStat, numStr, Chip } from '@/components/admin/dashboard/Primitives'
import type { Health, HealthTransitions, HealthGain } from '@/lib/shared/crm-insights-shared'

const scoreStr = (v: number | null) => (v == null ? 'n/a' : v.toFixed(1))

export default function HealthFactorsCard({
  health,
  transitions,
  gains,
}: {
  health: Health
  transitions: HealthTransitions
  gains: HealthGain[]
}) {
  const empty = health.scored === 0 && transitions.compared === 0 && gains.length === 0
  if (empty) return null

  return (
    <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
      <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest mb-4">Health Factors</h2>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
        <CompactStat label="Recency" value={scoreStr(health.recency)} />
        <CompactStat label="Frequency" value={scoreStr(health.frequency)} />
        <CompactStat label="Monetary" value={scoreStr(health.monetary)} />
        <CompactStat label="Engagement" value={scoreStr(health.engagement)} />
        <CompactStat label="Satisfaction" value={scoreStr(health.satisfaction)} />
        <CompactStat label="Scored customers" value={numStr(health.scored)} />
      </div>

      {transitions.compared > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          <Chip tone="bad">{numStr(transitions.healthyToHigh)} healthy to high risk</Chip>
          <Chip tone="warn">{numStr(transitions.healthyToRising)} healthy to rising</Chip>
          <Chip tone="warn">{numStr(transitions.risingToHigh)} rising to high</Chip>
          <Chip tone="good">{numStr(transitions.recovered)} recovered</Chip>
        </div>
      )}

      {gains.length > 0 && (
        <>
          <p className="text-[11px] uppercase tracking-wide text-foreground-muted font-medium mb-2">
            Biggest health gains
          </p>
          <div className="divide-y divide-border-default">
            {gains.map(g => (
              <Link
                key={g.id}
                href={ap(`/admin/customers/${g.id}`)}
                className="flex items-center gap-3 py-2 group hover:bg-surface-secondary/50 -mx-2 px-2 rounded-lg transition-colors"
              >
                <span className="text-xs font-medium text-foreground flex-1 truncate group-hover:text-accent-600 transition-colors">
                  {g.name}
                </span>
                <span className="text-xs text-foreground-secondary tabular-nums">Score {scoreStr(g.score)}</span>
                <Chip tone="good">+{g.delta == null ? 0 : Math.round(g.delta)}</Chip>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
