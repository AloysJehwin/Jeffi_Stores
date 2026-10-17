'use client'

import {
  usePeriod,
  PeriodBar,
  useOverviewData,
  AttentionList,
  type AttentionItem,
} from '@/components/admin/overview/kit'
import { Kpi, KpiGrid, Section, count } from '@/components/admin/channels/ui'
import { formatKpi, type OverviewKpi } from '@/lib/overviews/ops-kpi'
import { ap } from '@/lib/shared/admin-path'

interface Data {
  kpis: OverviewKpi[]
  by_admin: { admin_id: string | null; name: string; actions: number; risky: number }[]
  by_action: { action: string; actions: number }[]
  attention: AttentionItem[]
}

// Audit overview: actions by member and type, risky actions, failed sign-ins.
export default function AuditOverview() {
  const [period, setPeriod] = usePeriod()
  const { data, error, loading, reload } = useOverviewData<Data>(
    `/api/admin/audit/overview?from=${period.from}&to=${period.to}`
  )
  return (
    <div className="space-y-3">
      <PeriodBar value={period} onChange={setPeriod} onRefresh={reload} busy={loading} />
      {error && <p className="text-sm text-red-500">{error}</p>}
      {loading && <div className="h-24 rounded-xl bg-surface-elevated border border-border-default animate-pulse" />}
      {data && (
        <>
          <KpiGrid>
            {data.kpis.map(k => (
              <Kpi
                key={k.key}
                label={k.label}
                value={formatKpi(k.value, k.format)}
                delta={k.delta}
                invert={k.invert}
                sub={k.sub}
              />
            ))}
          </KpiGrid>
          <div className="grid gap-3 lg:grid-cols-3">
            <AttentionList items={data.attention.map(a => ({ ...a, href: a.href && ap(a.href) }))} />
            <Section title="By member">
              <ul className="space-y-1.5 text-sm">
                {data.by_admin.map(r => (
                  <li key={r.admin_id ?? 'system'} className="flex justify-between gap-2">
                    <span className="truncate">{r.name}</span>
                    <span className="tabular-nums text-foreground-muted">
                      {count(r.actions)}
                      {r.risky ? ` (${count(r.risky)} risky)` : ''}
                    </span>
                  </li>
                ))}
                {data.by_admin.length === 0 && <li className="text-foreground-muted">No actions in this period.</li>}
              </ul>
            </Section>
            <Section title="By action">
              <ul className="space-y-1.5 text-sm">
                {data.by_action.map(r => (
                  <li key={r.action} className="flex justify-between gap-2">
                    <span className="capitalize truncate">{r.action.replace(/_/g, ' ')}</span>
                    <span className="tabular-nums text-foreground-muted">{count(r.actions)}</span>
                  </li>
                ))}
                {data.by_action.length === 0 && <li className="text-foreground-muted">No actions in this period.</li>}
              </ul>
            </Section>
          </div>
        </>
      )}
    </div>
  )
}
