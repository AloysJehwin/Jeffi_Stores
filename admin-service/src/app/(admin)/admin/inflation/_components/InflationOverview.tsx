'use client'

import { Badge, Kpi, Section, Table, count, pct, when } from '@/components/admin/channels/ui'
import { delta } from '@/lib/overview/period'
import type { AttentionItem } from '@/components/admin/overview/kit'
import { OverviewTab } from '../../products/_components/catalog-overview'

interface RunStats {
  runs: number
  rollbacks: number
  products: number
  categories: number
  avgChange: number | null
}

interface Run {
  id: string
  categoryName: string
  percentage: number | null
  products: number
  by: string | null
  at: string | null
  isRollback: boolean
  rolledBackAt: string | null
}

interface InflationOverviewData {
  current: RunStats
  previousStats: RunStats
  lastRun: Run | null
  recent: Run[]
  staleCount: number
  attention: AttentionItem[]
}

const percent = (v: number | null) => (v == null ? '-' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`)

export default function InflationOverview() {
  return (
    <OverviewTab<InflationOverviewData>
      endpoint="/api/admin/inflation/overview"
      kpis={d => (
        <>
          <Kpi
            label="Price runs"
            value={count(d.current.runs)}
            delta={delta(d.current.runs, d.previousStats.runs)}
            sub={`${count(d.current.categories)} categories`}
          />
          <Kpi
            label="Products affected"
            value={count(d.current.products)}
            delta={delta(d.current.products, d.previousStats.products)}
            highlight
          />
          <Kpi label="Average change" value={percent(d.current.avgChange)} sub="per product affected" />
          <Kpi label="Rolled back" value={count(d.current.rollbacks)} />
          <Kpi
            label="Last run"
            value={
              d.lastRun?.at
                ? new Date(d.lastRun.at).toLocaleDateString('en-IN', {
                    timeZone: 'Asia/Kolkata',
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })
                : 'Never'
            }
            sub={d.lastRun ? `${d.lastRun.categoryName} ${percent(d.lastRun.percentage)}` : undefined}
          />
          <Kpi label="Not repriced" value={count(d.staleCount)} sub="categories, 180 days" />
        </>
      )}
      extra={d => (
        <Section title="Recent runs">
          <Table
            rows={d.recent}
            rowKey={r => r.id}
            pageSize={8}
            empty="No bulk price changes yet"
            cols={[
              { key: 'cat', label: 'Category', render: r => r.categoryName },
              { key: 'pct', label: 'Change', num: true, render: r => percent(r.percentage) },
              { key: 'n', label: 'Products', num: true, render: r => count(r.products) },
              {
                key: 'state',
                label: 'State',
                render: r =>
                  r.isRollback ? (
                    <Badge tone="amber">Rollback</Badge>
                  ) : r.rolledBackAt ? (
                    <Badge>Rolled back</Badge>
                  ) : (
                    <Badge tone="green">Applied</Badge>
                  ),
              },
              { key: 'at', label: 'When', render: r => when(r.at) },
            ]}
          />
        </Section>
      )}
    />
  )
}
