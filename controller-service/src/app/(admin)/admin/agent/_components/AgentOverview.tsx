'use client'

import {
  usePeriod,
  PeriodBar,
  useOverviewData,
  AttentionList,
  type AttentionItem,
} from '@/components/admin/overview/kit'
import { Kpi, KpiGrid, Section, Table, count } from '@/components/admin/channels/ui'
import { formatKpi, type OverviewKpi } from '@/lib/overviews/ops-kpi'
import { ap } from '@/lib/shared/admin-path'

interface Data {
  kpis: OverviewKpi[]
  top_tools: { tool: string; calls: number; errors: number }[]
  attention: AttentionItem[]
}

// Agent usage strip: conversations, tool calls, actions, approvals and AI spend.
export default function AgentOverview() {
  const [period, setPeriod] = usePeriod()
  const { data, error, loading, reload } = useOverviewData<Data>(
    `/api/admin/agent/overview?from=${period.from}&to=${period.to}`
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
          <div className="grid gap-3 lg:grid-cols-2">
            <AttentionList items={data.attention.map(a => ({ ...a, href: a.href && ap(a.href) }))} />
            <Section title="Tools used">
              <Table
                rows={data.top_tools}
                rowKey={r => r.tool}
                empty="No tool calls in this period"
                pageSize={8}
                cols={[
                  { key: 'tool', label: 'Tool', render: r => <span className="font-mono text-xs">{r.tool}</span> },
                  { key: 'calls', label: 'Calls', num: true, render: r => count(r.calls), sort: r => r.calls },
                  { key: 'errors', label: 'Errors', num: true, render: r => count(r.errors), sort: r => r.errors },
                ]}
              />
            </Section>
          </div>
        </>
      )}
    </div>
  )
}
