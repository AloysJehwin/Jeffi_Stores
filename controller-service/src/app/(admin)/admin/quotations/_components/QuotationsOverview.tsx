'use client'

import Link from 'next/link'
import { AttentionList, OverviewSkeleton, PeriodBar, useOverviewData, usePeriod } from '@/components/admin/overview/kit'
import { Badge, Kpi, KpiGrid, Section, Table, count, money, pct } from '@/components/admin/channels/ui'
import { TrendChart, type SeriesDef } from '@/components/admin/dashboard/Charts'
import { delta } from '@/lib/overview/period'
import { ap } from '@/lib/shared/admin-path'
import type { QuotationOverview } from '@/lib/overviews/quotations'

const SERIES: SeriesDef[] = [
  { key: 'sentValue', label: 'Quoted value', color: 'rgb(59 130 246)', kind: 'area', axis: 'money' },
  { key: 'sent', label: 'Sent', color: 'rgb(224 123 63)', kind: 'bar', axis: 'count' },
  { key: 'accepted', label: 'Accepted', color: 'rgb(16 185 129)', kind: 'line', axis: 'count' },
]

const days = (v: number | null) =>
  v == null ? '-' : v < 1 ? `${Math.max(1, Math.round(v * 24))}h` : `${v.toFixed(1)}d`

export default function QuotationsOverview() {
  const [period, setPeriod] = usePeriod()
  const { data, error, loading, reload } = useOverviewData<QuotationOverview>(
    `/api/admin/quotations/overview?from=${period.from}&to=${period.to}`
  )

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Quotations</h1>
        <p className="text-sm text-foreground-muted mt-0.5">
          Quotes sent, accepted and converted to invoices, and the open pipeline
        </p>
      </div>
      <PeriodBar value={period} onChange={setPeriod} onRefresh={reload} busy={loading} />
      {error && <p className="text-sm text-red-500">{error}</p>}
      {!data ? loading && <OverviewSkeleton /> : <Body d={data} />}
    </div>
  )
}

function Body({ d }: { d: QuotationOverview }) {
  const c = d.kpis.current
  const p = d.kpis.previous
  const w = d.won.current
  const wp = d.won.previous
  return (
    <>
      <KpiGrid>
        <Kpi
          label="Sent"
          value={count(c.sent)}
          delta={delta(c.sent, p.sent)}
          sub={`${count(c.created)} created, ${count(c.customers)} customers`}
        />
        <Kpi label="Quoted value" value={money(c.sentValue)} delta={delta(c.sentValue, p.sentValue)} highlight />
        <Kpi
          label="Accepted"
          value={count(c.accepted)}
          delta={delta(c.accepted, p.accepted)}
          sub={`${money(c.acceptedValue)} of those quotes`}
        />
        <Kpi
          label="Conversion"
          value={pct(c.conversion)}
          delta={delta(c.conversion, p.conversion)}
          sub={`${pct(c.valueConversion)} by value`}
        />
        <Kpi
          label="Won in period"
          value={money(w.value)}
          delta={delta(w.value, wp.value)}
          sub={`${count(w.count)} invoices from quotes`}
        />
        <Kpi
          label="Time to accept"
          value={days(w.avgDaysToAccept)}
          delta={delta(w.avgDaysToAccept, wp.avgDaysToAccept)}
          invert
          sub="Quote created to invoice"
        />
        <Kpi
          label="Open pipeline"
          value={money(d.pipeline.openValue)}
          sub={`${count(d.pipeline.open)} quotes within ${d.validDays} days`}
        />
        <Kpi label="Expiring this week" value={count(d.pipeline.expiring)} sub={money(d.pipeline.expiringValue)} />
        <Kpi label="Average quote" value={money(c.avgQuote)} delta={delta(c.avgQuote, p.avgQuote)} />
        <Kpi
          label="Lapsed"
          value={count(d.pipeline.lapsed)}
          sub={`${money(d.pipeline.lapsedValue)} past ${d.validDays} days`}
        />
      </KpiGrid>
      <p className="text-[11px] text-foreground-muted -mt-2">
        Sent and conversion count finalized quotes dated in the period; accepted means converted to an invoice. Quotes
        carry no validity date, so open means finalized and unconverted within {d.validDays} days of the quote date.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <AttentionList items={d.attention.map(a => ({ ...a, href: a.href && ap(a.href) }))} />
        <Section title="Expiring soon">
          <Table
            rows={d.expiring}
            rowKey={r => r.id}
            empty="No open quotations"
            cols={[
              {
                key: 'number',
                label: 'Quote',
                render: r => (
                  <Link href={ap(r.href)} className="text-accent-500 hover:underline">
                    {r.number}
                  </Link>
                ),
              },
              { key: 'customer', label: 'Customer', render: r => r.customer },
              {
                key: 'left',
                label: 'Left',
                num: true,
                render: r => <Badge tone={r.daysLeft <= 7 ? 'amber' : 'muted'}>{r.daysLeft}d</Badge>,
              },
              { key: 'amount', label: 'Value', num: true, render: r => money(r.amount) },
            ]}
          />
        </Section>
      </div>

      <Section title="Quotes over time">
        <TrendChart
          points={d.series}
          bucket={d.bucket}
          series={SERIES}
          ariaLabel="Quotations sent and accepted over time"
        />
      </Section>

      <Section title="Top customers">
        <Table
          rows={d.topCustomers}
          rowKey={r => r.name}
          empty="No quotations sent in this period"
          cols={[
            { key: 'name', label: 'Customer', render: r => r.name },
            { key: 'quotes', label: 'Quotes', num: true, sort: r => r.quotes, render: r => count(r.quotes) },
            { key: 'quoted', label: 'Quoted', num: true, sort: r => r.quoted, render: r => money(r.quoted) },
            { key: 'accepted', label: 'Accepted', num: true, sort: r => r.accepted, render: r => count(r.accepted) },
            {
              key: 'value',
              label: 'Accepted value',
              num: true,
              sort: r => r.acceptedValue,
              render: r => money(r.acceptedValue),
            },
            { key: 'rate', label: 'Conversion', num: true, render: r => pct(r.quotes ? r.accepted / r.quotes : null) },
          ]}
        />
      </Section>
    </>
  )
}
