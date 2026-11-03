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
import { Kpi, KpiGrid, Section, Table, Badge, money, count, pct } from '@/components/admin/channels/ui'
import { TrendChart, type SeriesDef } from '@/components/admin/dashboard/Charts'
import { formatKpi, type OverviewKpi } from '@/lib/overviews/ops-kpi'
import { ap } from '@/lib/shared/admin-path'
import { ListFilters, useFilterQuery } from '@/components/admin/kit'
import { RFQ_FIELDS, RFQ_SEARCH } from '@/lib/filters/fields/business-rfqs'

interface Totals {
  received: number
  converted: number
  won: number
  quoted_value: number
  won_value: number
  conversion_rate: number | null
}
interface Data {
  kpis: OverviewKpi[]
  bucket: 'day' | 'week' | 'month'
  series: { label: string; received: number; converted: number }[]
  by_status: { status: string; count: number }[]
  top_customers: ({ user_id: string; name: string } & Totals)[]
  awaiting: {
    id: string
    rfq_number: string
    status: string
    company_name: string | null
    waiting_hours: number | null
  }[]
  attention: AttentionItem[]
}

const SERIES: SeriesDef[] = [
  { key: 'received', label: 'Received', color: 'rgb(59 130 246)', kind: 'bar', axis: 'count', on: true },
  { key: 'converted', label: 'Converted', color: 'rgb(16 185 129)', kind: 'line', axis: 'count', on: true },
]

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  reviewed: 'Reviewed',
  negotiating: 'Negotiating',
  offer_accepted: 'Offer accepted',
  converted: 'Converted',
  rejected: 'Rejected',
}

const waited = (h: number | null) => (h == null ? '-' : h < 24 ? `${Math.round(h)} h` : `${Math.floor(h / 24)} d`)

export default function RfqsOverview() {
  const [period, setPeriod] = usePeriod()
  // KPIs and charts follow the RFQ list's filters; the PeriodBar owns from / to.
  const filters = useFilterQuery(RFQ_FIELDS, { omit: ['from', 'to'] })
  const { data, error, loading, reload } = useOverviewData<Data>(
    `/api/admin/business/rfqs/overview?from=${period.from}&to=${period.to}${filters ? `&${filters}` : ''}`
  )
  // A status row opens the list with these filters and that status.
  const statusHref = (status: string) => {
    const p = new URLSearchParams(filters)
    p.set('tab', 'list')
    p.set('status', status)
    return ap(`/admin/business/rfqs?${p}`)
  }

  return (
    <div className="space-y-4">
      <PeriodBar value={period} onChange={setPeriod} onRefresh={reload} busy={loading} />
      <ListFilters entity="business_rfqs" fields={RFQ_FIELDS} search={RFQ_SEARCH} period noun="RFQs" tab="overview" exportable />
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
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Section title="RFQs received and converted">
                <TrendChart
                  points={data.series}
                  bucket={data.bucket}
                  series={SERIES}
                  ariaLabel="RFQs received and converted"
                />
              </Section>
            </div>
            <Section title="All RFQs by status">
              {data.by_status.length === 0 ? (
                <p className="text-sm text-foreground-muted">No RFQs yet.</p>
              ) : (
                <ul className="space-y-2">
                  {data.by_status.map(s => (
                    <li key={s.status}>
                      <Link
                        href={statusHref(s.status)}
                        className="flex items-center justify-between text-sm hover:text-accent-500"
                      >
                        <span>{STATUS_LABEL[s.status] ?? s.status}</span>
                        <span className="tabular-nums">{count(s.count)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Section title="Top B2B customers">
              <Table
                rows={data.top_customers}
                rowKey={r => r.user_id}
                empty="No RFQs in this period"
                cols={[
                  { key: 'name', label: 'Customer', render: r => r.name },
                  { key: 'received', label: 'RFQs', num: true, render: r => count(r.received), sort: r => r.received },
                  {
                    key: 'conv',
                    label: 'Converted',
                    num: true,
                    render: r => pct(r.conversion_rate),
                    sort: r => r.conversion_rate ?? 0,
                  },
                  {
                    key: 'quoted',
                    label: 'Quoted',
                    num: true,
                    render: r => money(r.quoted_value),
                    sort: r => r.quoted_value,
                  },
                  { key: 'won', label: 'Won', num: true, render: r => money(r.won_value), sort: r => r.won_value },
                ]}
              />
            </Section>
            <Section title="Waiting for a reply">
              <Table
                rows={data.awaiting}
                rowKey={r => r.id}
                empty="Every open RFQ has a reply"
                cols={[
                  {
                    key: 'rfq',
                    label: 'RFQ',
                    render: r => (
                      <Link
                        href={ap(`/admin/business/rfqs/${r.id}/view`)}
                        className="font-mono text-xs hover:text-accent-500 hover:underline"
                      >
                        {r.rfq_number}
                      </Link>
                    ),
                  },
                  { key: 'company', label: 'Company', render: r => r.company_name || '-' },
                  {
                    key: 'status',
                    label: 'Status',
                    render: r => <Badge tone="amber">{STATUS_LABEL[r.status] ?? r.status}</Badge>,
                  },
                  {
                    key: 'wait',
                    label: 'Waiting',
                    num: true,
                    render: r => waited(r.waiting_hours),
                    sort: r => r.waiting_hours ?? 0,
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
