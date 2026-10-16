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
import { Kpi, KpiGrid, Section, Table, Badge, money, count, pct, btnGhost } from '@/components/admin/channels/ui'
import { TrendChart, type SeriesDef } from '@/components/admin/dashboard/Charts'
import { formatKpi, type OverviewKpi } from '@/lib/overviews/ops-kpi'
import { ap } from '@/lib/shared/admin-path'

interface Data {
  kpis: OverviewKpi[]
  bucket: 'day' | 'week' | 'month'
  series: { label: string; received: number; raised: number }[]
  top_suppliers: {
    id: string
    name: string
    received: number
    grns: number
    on_time_rate: number | null
    lead_days: number | null
    payable: number
    open_pos: number
  }[]
  overdue_pos: {
    id: string
    po_number: string
    supplier_name: string | null
    expected_date: string
    days_late: number
    total_amount: number
  }[]
  attention: AttentionItem[]
}

const SERIES: SeriesDef[] = [
  { key: 'raised', label: 'POs raised', color: 'rgb(59 130 246)', kind: 'bar', axis: 'money', on: true },
  { key: 'received', label: 'Received', color: 'rgb(16 185 129)', kind: 'line', axis: 'money', on: true },
]

export default function SuppliersOverview() {
  const [period, setPeriod] = usePeriod()
  const { data, error, loading, reload } = useOverviewData<Data>(
    `/api/admin/suppliers/overview?from=${period.from}&to=${period.to}`
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Link href={ap('/admin/inventory?tab=suppliers')} className={btnGhost}>
          All suppliers
        </Link>
        <Link href={ap('/admin/inventory?tab=po')} className={btnGhost}>
          Purchase orders
        </Link>
        <Link href={ap('/admin/financial?tab=payables')} className={btnGhost}>
          Payables
        </Link>
      </div>
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
          <Section title="Purchasing">
            <TrendChart
              points={data.series}
              bucket={data.bucket}
              series={SERIES}
              ariaLabel="PO value raised and goods received"
            />
          </Section>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Section title="Top suppliers">
                <Table
                  rows={data.top_suppliers}
                  rowKey={r => r.id}
                  empty="No supplier activity"
                  cols={[
                    {
                      key: 'name',
                      label: 'Supplier',
                      render: r => (
                        <Link
                          href={ap(`/admin/suppliers/${r.id}/view`)}
                          className="hover:text-accent-500 hover:underline"
                        >
                          {r.name}
                        </Link>
                      ),
                    },
                    {
                      key: 'recv',
                      label: 'Received',
                      num: true,
                      render: r => money(r.received),
                      sort: r => r.received,
                    },
                    {
                      key: 'ontime',
                      label: 'On time',
                      num: true,
                      render: r => pct(r.on_time_rate, 0),
                      sort: r => r.on_time_rate ?? -1,
                    },
                    {
                      key: 'lead',
                      label: 'Lead',
                      num: true,
                      render: r => (r.lead_days == null ? '-' : `${r.lead_days.toFixed(1)} d`),
                      sort: r => r.lead_days ?? -1,
                    },
                    {
                      key: 'open',
                      label: 'Open POs',
                      num: true,
                      render: r => count(r.open_pos),
                      sort: r => r.open_pos,
                    },
                    { key: 'pay', label: 'Payable', num: true, render: r => money(r.payable), sort: r => r.payable },
                  ]}
                />
              </Section>
            </div>
            <Section title="Late purchase orders">
              {data.overdue_pos.length === 0 ? (
                <p className="text-sm text-foreground-muted">No open PO is past its expected date.</p>
              ) : (
                <ul className="divide-y divide-border-default">
                  {data.overdue_pos.map(p => (
                    <li key={p.id}>
                      <Link
                        href={ap(`/admin/inventory?tab=po&po=${p.id}`)}
                        className="flex items-start justify-between gap-2 py-2 text-sm hover:text-accent-500"
                      >
                        <span className="min-w-0">
                          <span className="block font-mono text-xs">{p.po_number}</span>
                          <span className="block text-xs text-foreground-muted truncate">{p.supplier_name || '-'}</span>
                        </span>
                        <Badge tone={p.days_late > 7 ? 'red' : 'amber'}>{p.days_late} d late</Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </>
      )}
    </div>
  )
}
