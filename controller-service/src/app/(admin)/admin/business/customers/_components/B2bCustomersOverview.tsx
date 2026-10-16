'use client'

import Link from 'next/link'
import {
  usePeriod,
  PeriodBar,
  useOverviewData,
  AttentionList,
  OverviewSkeleton,
  type AttentionItem,
} from '@/components/admin/overview/kit'
import { Kpi, KpiGrid, Section, Table, money, count, when } from '@/components/admin/channels/ui'
import { TrendChart, type SeriesDef } from '@/components/admin/dashboard/Charts'
import { formatKpi, type OverviewKpi } from '@/lib/overviews/ops-kpi'
import { ap } from '@/lib/shared/admin-path'

interface Data {
  kpis: OverviewKpi[]
  bucket: 'day' | 'week' | 'month'
  series: { label: string; sales: number; orders: number }[]
  accounts: { approved: number; pending: number; rejected: number }
  top_customers: {
    key: string
    user_id: string | null
    name: string
    sales: number
    orders: number
    outstanding: number
  }[]
  pending: { user_id: string; company_name: string; created_at: string }[]
  attention: AttentionItem[]
}

const SERIES: SeriesDef[] = [
  { key: 'sales', label: 'B2B sales', color: 'rgb(16 185 129)', kind: 'area', axis: 'money', on: true },
  { key: 'orders', label: 'Orders', color: 'rgb(224 123 63)', kind: 'bar', axis: 'count', on: true },
]

export default function B2bCustomersOverview() {
  const [period, setPeriod] = usePeriod()
  const { data, error, loading, reload } = useOverviewData<Data>(
    `/api/admin/business/customers/overview?from=${period.from}&to=${period.to}`
  )

  return (
    <div className="space-y-4">
      <PeriodBar value={period} onChange={setPeriod} onRefresh={reload} busy={loading} />
      {error && <p className="text-sm text-red-500">{error}</p>}
      {loading || !data ? (
        !error && <OverviewSkeleton />
      ) : (
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
          <AttentionList items={data.attention.map(a => ({ ...a, href: a.href && ap(a.href) }))} />
          <Section title="B2B sales">
            <TrendChart points={data.series} bucket={data.bucket} series={SERIES} ariaLabel="B2B sales and orders" />
          </Section>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Section title="Top B2B customers">
                <Table
                  rows={data.top_customers}
                  rowKey={r => r.key}
                  empty="No B2B orders in this period"
                  cols={[
                    {
                      key: 'name',
                      label: 'Customer',
                      render: r =>
                        r.user_id ? (
                          <Link
                            href={ap(`/admin/business/customers/${r.user_id}/view`)}
                            className="hover:text-accent-500 hover:underline"
                          >
                            {r.name}
                          </Link>
                        ) : (
                          r.name
                        ),
                    },
                    { key: 'orders', label: 'Orders', num: true, render: r => count(r.orders), sort: r => r.orders },
                    { key: 'sales', label: 'Sales', num: true, render: r => money(r.sales), sort: r => r.sales },
                    {
                      key: 'out',
                      label: 'Outstanding',
                      num: true,
                      render: r => money(r.outstanding),
                      sort: r => r.outstanding,
                    },
                  ]}
                />
              </Section>
            </div>
            <Section title="Applications to review">
              {data.pending.length === 0 ? (
                <p className="text-sm text-foreground-muted">No applications waiting.</p>
              ) : (
                <ul className="divide-y divide-border-default">
                  {data.pending.map(p => (
                    <li key={p.user_id}>
                      <Link
                        href={ap(`/admin/business/customers/${p.user_id}/view`)}
                        className="flex items-center justify-between gap-2 py-2 text-sm hover:text-accent-500"
                      >
                        <span className="truncate">{p.company_name}</span>
                        <span className="text-xs text-foreground-muted whitespace-nowrap">{when(p.created_at)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-xs text-foreground-muted">
                {count(data.accounts.approved)} approved, {count(data.accounts.rejected)} rejected
              </p>
            </Section>
          </div>
        </>
      )}
    </div>
  )
}
