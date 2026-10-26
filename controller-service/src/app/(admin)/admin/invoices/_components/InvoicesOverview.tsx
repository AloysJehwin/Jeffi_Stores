'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { INVOICE_ALIASES, INVOICE_FIELDS, INVOICE_SEARCH } from '@jeffi/list-filters/fields'
import { ListFilters, useFilterQuery } from '@/components/admin/kit'
import { AttentionList, OverviewSkeleton, PeriodBar, useOverviewData, usePeriod } from '@/components/admin/overview/kit'
import { Badge, Kpi, KpiGrid, Section, Table, count, money, pct } from '@/components/admin/channels/ui'
import { DonutSplit, RankedBars, TrendChart, type SeriesDef } from '@/components/admin/dashboard/Charts'
import { MAX_SPAN_DAYS, delta } from '@/lib/overview/period'
import { ap } from '@/lib/shared/admin-path'
import type { InvoiceOverview } from '@/lib/overviews/invoices'

const SERIES: SeriesDef[] = [
  { key: 'value', label: 'Invoiced', color: 'rgb(16 185 129)', kind: 'area', axis: 'money' },
  { key: 'invoices', label: 'Invoices', color: 'rgb(224 123 63)', kind: 'bar', axis: 'count' },
  { key: 'gst', label: 'GST', color: 'rgb(59 130 246)', kind: 'line', axis: 'money', on: false },
]

const SOURCE_LABEL: Record<string, string> = {
  online: 'Online',
  offline: 'Offline',
  business: 'Business (B2B)',
  cash_sale: 'Cash sale',
}
const AGING_TONE = ['bg-green-500', 'bg-amber-500', 'bg-orange-500', 'bg-red-500']

export default function InvoicesOverview() {
  const [period, setPeriod] = usePeriod()
  const sp = useSearchParams()
  // KPIs and charts follow the list's filters; the PeriodBar owns from / to (the invoice date).
  const filters = useFilterQuery(INVOICE_FIELDS, { aliases: INVOICE_ALIASES, omit: ['from', 'to'] })
  const { data, error, loading, reload } = useOverviewData<InvoiceOverview>(
    `/api/admin/invoices/overview?from=${period.from}&to=${period.to}${filters ? `&${filters}` : ''}`
  )
  const clamped = !!sp.get('from') && sp.get('from') !== period.from

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Invoices</h1>
        <p className="text-sm text-foreground-muted mt-0.5">
          Invoiced value, GST, collections and e-invoicing across orders and cash sales
        </p>
      </div>
      <PeriodBar value={period} onChange={setPeriod} onRefresh={reload} busy={loading} />
      <ListFilters
        entity="invoices"
        fields={INVOICE_FIELDS}
        aliases={INVOICE_ALIASES}
        search={INVOICE_SEARCH}
        period
        noun="Invoices"
        tab="overview"
      />
      {clamped && (
        <p className="text-xs text-foreground-muted">
          The overview covers at most {MAX_SPAN_DAYS} days: showing {period.from} to {period.to}.
        </p>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
      {!data ? loading && <OverviewSkeleton /> : <Body d={data} />}
    </div>
  )
}

function Body({ d }: { d: InvoiceOverview }) {
  const c = d.kpis.current
  const p = d.kpis.previous
  const collected = c.paidValue + c.unpaidValue ? c.paidValue / (c.paidValue + c.unpaidValue) : null
  return (
    <>
      <KpiGrid>
        <Kpi label="Invoiced value" value={money(c.value)} delta={delta(c.value, p.value)} highlight />
        <Kpi
          label="Invoices"
          value={count(c.invoices)}
          delta={delta(c.invoices, p.invoices)}
          sub={`${count(c.customers)} customers`}
        />
        <Kpi
          label="GST collected"
          value={money(c.gst)}
          delta={delta(c.gst, p.gst)}
          sub={`on ${money(c.taxable)} taxable`}
        />
        <Kpi label="Average invoice" value={money(c.avgInvoice)} delta={delta(c.avgInvoice, p.avgInvoice)} />
        <Kpi label="Paid" value={money(c.paidValue)} sub={`${count(c.paid)} invoices, ${pct(collected)} collected`} />
        <Kpi
          label="Unpaid"
          value={money(c.unpaidValue)}
          delta={delta(c.unpaidValue, p.unpaidValue)}
          invert
          sub={`${count(c.unpaid)} invoices`}
        />
        <Kpi
          label="Outstanding (all)"
          value={money(d.outstanding.total)}
          sub={`${count(d.outstanding.count)} invoices, ${money(d.outstanding.overdue)} over 30 days`}
        />
        <Kpi
          label="E-invoice coverage"
          value={pct(c.eInvoiceCoverage)}
          sub={c.b2b ? `${count(c.b2bIrn)} of ${count(c.b2b)} B2B invoices have an IRN` : 'No B2B invoices in period'}
        />
        <Kpi label="Refunded" value={money(c.refundedValue)} invert delta={delta(c.refundedValue, p.refundedValue)} />
        <Kpi label="Voided" value={count(c.voided)} invert delta={delta(c.voided, p.voided)} />
      </KpiGrid>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <AttentionList items={d.attention.map(a => ({ ...a, href: a.href && ap(a.href) }))} />
        <Section title="Unpaid by age">
          <div className="space-y-3">
            {d.outstanding.aging.map((b, i) => {
              const share = d.outstanding.total ? b.amount / d.outstanding.total : 0
              return (
                <div key={b.key}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-foreground">{b.label}</span>
                    <span className="text-foreground-muted tabular-nums">
                      {money(b.amount)} ({count(b.count)})
                    </span>
                  </div>
                  <div className="h-1.5 bg-surface-secondary rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${AGING_TONE[i]}`}
                      style={{ width: `${Math.round(share * 100)}%` }}
                    />
                  </div>
                </div>
              )
            })}
            <p className="text-[11px] text-foreground-muted">
              Days since the invoice date; no credit terms are stored.
            </p>
          </div>
        </Section>
      </div>

      <Section title="Invoiced over time">
        <TrendChart
          points={d.series}
          bucket={d.bucket}
          series={SERIES}
          ariaLabel="Invoiced value and invoices over time"
        />
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Section title="Paid vs unpaid">
          <DonutSplit
            segments={[
              { label: 'Paid', value: c.paidValue, color: 'rgb(16 185 129)' },
              { label: 'Unpaid', value: c.unpaidValue, color: 'rgb(234 179 8)' },
              { label: 'Refunded', value: c.refundedValue, color: 'rgb(239 68 68)' },
            ]}
            centerLabel="Invoiced"
            centerValue={money(c.value)}
          />
        </Section>
        <Section title="By channel">
          <RankedBars
            items={d.bySource.map(s => ({
              name: SOURCE_LABEL[s.source] ?? s.source,
              value: s.amount,
              sub: `${money(s.amount)} (${count(s.count)})`,
            }))}
          />
        </Section>
        <Section title="By GST rate">
          <Table
            rows={d.byRate}
            rowKey={r => String(r.rate)}
            empty="No invoice lines in this period"
            cols={[
              {
                key: 'rate',
                label: 'Rate',
                render: r => (r.rate == null ? <Badge tone="amber">Not set</Badge> : `${r.rate}%`),
              },
              { key: 'taxable', label: 'Taxable', num: true, render: r => money(r.taxable) },
              { key: 'gst', label: 'GST', num: true, render: r => money(r.gst) },
            ]}
          />
        </Section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Section title="Oldest unpaid invoices">
          <Table
            rows={d.oldestUnpaid}
            rowKey={r => r.id}
            empty="No unpaid invoices"
            cols={[
              {
                key: 'number',
                label: 'Invoice',
                render: r => (
                  <Link href={ap(r.href)} className="text-accent-500 hover:underline">
                    {r.number}
                  </Link>
                ),
              },
              { key: 'customer', label: 'Customer', render: r => r.customer },
              {
                key: 'days',
                label: 'Age',
                num: true,
                render: r => <Badge tone={r.days > 60 ? 'red' : r.days > 30 ? 'amber' : 'muted'}>{r.days}d</Badge>,
              },
              { key: 'amount', label: 'Amount', num: true, render: r => money(r.amount) },
            ]}
          />
        </Section>
        <Section title="Top customers">
          <Table
            rows={d.topCustomers}
            rowKey={r => r.name}
            empty="No invoices in this period"
            cols={[
              { key: 'name', label: 'Customer', render: r => r.name },
              { key: 'count', label: 'Invoices', num: true, render: r => count(r.count) },
              { key: 'amount', label: 'Value', num: true, render: r => money(r.amount) },
              {
                key: 'unpaid',
                label: 'Unpaid',
                num: true,
                render: r =>
                  r.unpaid ? <span className="text-amber-600 dark:text-amber-400">{money(r.unpaid)}</span> : '-',
              },
            ]}
          />
        </Section>
      </div>
    </>
  )
}
