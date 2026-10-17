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
  by_assignee: {
    admin_id: string | null
    name: string
    open: number
    overdue: number
    completed: number
    hours: number | null
  }[]
  attention: AttentionItem[]
}

// Tasks overview: open, overdue, throughput and load by assignee.
export default function TasksOverview() {
  const [period, setPeriod] = usePeriod()
  const { data, error, loading, reload } = useOverviewData<Data>(
    `/api/admin/tasks/overview?from=${period.from}&to=${period.to}`
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
          <div className="grid gap-3 md:grid-cols-2">
            <AttentionList items={data.attention.map(a => ({ ...a, href: a.href && ap(a.href) }))} />
            <Section title="By assignee">
              <Table
                rows={data.by_assignee}
                rowKey={r => r.admin_id ?? 'none'}
                empty="No tasks"
                pageSize={6}
                cols={[
                  { key: 'name', label: 'Assignee', render: r => r.name },
                  { key: 'open', label: 'Open', num: true, render: r => count(r.open), sort: r => r.open },
                  { key: 'overdue', label: 'Overdue', num: true, render: r => count(r.overdue), sort: r => r.overdue },
                  { key: 'done', label: 'Done', num: true, render: r => count(r.completed), sort: r => r.completed },
                  {
                    key: 'time',
                    label: 'Avg time',
                    num: true,
                    render: r => formatKpi(r.hours, 'hours'),
                    sort: r => r.hours ?? -1,
                  },
                ]}
              />
            </Section>
          </div>
        </>
      )}
    </div>
  )
}
