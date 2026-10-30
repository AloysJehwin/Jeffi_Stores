'use client'

import Link from 'next/link'
import { Banner, Kpi, KpiGrid, Section, Table, money, type Col } from '@/components/admin/channels/ui'
import { OverviewSkeleton, useOverviewData } from '@/components/admin/overview/kit'
import { delta } from '@/lib/overview/period'
import { CashflowTrendCard, MixDonutCard, type TrendPoint } from './OverviewCharts'
import { FinancePeriodBar, useFinancePeriod, type FinanceOverviewContract } from './finance'

type Totals = {
  cash_in: number
  cash_out: number
  net: number
  opening_balance: number
  closing_balance: number
}

type DimRow = { key: string; label: string; amount: number }

type MonthRow = {
  month: string
  cash_in: number
  cash_in_online: number
  cash_in_business: number
  cash_in_cash_sale: number
  cash_in_offline: number
  po_payments: number
  refunds_out: number
  cash_out: number
  net: number
  running_balance: number
}

type Cashflow = FinanceOverviewContract<Totals, DimRow> & { monthly: MonthRow[] }

const SOURCE_COLOR: Record<string, string> = {
  online: 'rgb(59 130 246)',
  business: 'rgb(168 85 247)',
  cash_sale: 'rgb(16 185 129)',
  offline: 'rgb(234 179 8)',
}

const signed = (v: number) => (v >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400')
const monthLabel = (m: string) => new Date(m + '-01').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })

// FinancialClient still passes the FY-range initial payload; useOverviewData refetches on URL
// changes, so initialData only avoids a first-render flash when the user lands on tab=cashflow
// without ?from/?to.
export function CashflowTab({ initialData }: { initialData?: unknown }) {
  const { range } = useFinancePeriod('fy')
  const url = `/api/admin/financial/cashflow?from=${range.from}&to=${range.to}`
  const { data, error, loading, reload } = useOverviewData<Cashflow>(url)
  const seeded = isCashflow(initialData) ? initialData : null
  const d = data ?? seeded

  return (
    <div className="space-y-5">
      <FinancePeriodBar defaultPreset="fy" onRefresh={reload} busy={loading} />
      {error && <Banner ok={false}>{error}</Banner>}
      {loading && !d ? <OverviewSkeleton /> : d ? <Body d={d} /> : null}
    </div>
  )
}

function isCashflow(v: unknown): v is Cashflow {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return !!o.range && !!o.current && Array.isArray((o as { monthly?: unknown }).monthly)
}

function Body({ d }: { d: Cashflow }) {
  const c = d.current
  const p = d.previous

  const monthHref = (m: string) =>
    `/admin/financial?tab=cashflow&month=${m}&from=${d.range.from}&to=${d.range.to}`

  const cols: Col<MonthRow>[] = [
    {
      key: 'month',
      label: 'Month',
      render: m => (
        <Link href={monthHref(m.month)} className="font-medium text-foreground hover:text-accent-500 underline decoration-dotted underline-offset-2">
          {monthLabel(m.month)}
        </Link>
      ),
    },
    {
      key: 'cash_in',
      label: 'Cash in',
      num: true,
      render: m => <span className={`font-medium ${signed(m.cash_in)}`}>{money(m.cash_in)}</span>,
    },
    {
      key: 'po_payments',
      label: 'Supplier',
      num: true,
      render: m => <span className="text-foreground-muted">{m.po_payments > 0 ? money(m.po_payments) : '-'}</span>,
    },
    {
      key: 'refunds_out',
      label: 'Refunds',
      num: true,
      render: m => <span className="text-foreground-muted">{m.refunds_out > 0 ? money(m.refunds_out) : '-'}</span>,
    },
    {
      key: 'cash_out',
      label: 'Cash out',
      num: true,
      render: m => <span className="text-red-500">{money(m.cash_out)}</span>,
    },
    {
      key: 'net',
      label: 'Net',
      num: true,
      render: m => (
        <span className={`font-medium ${signed(m.net)}`}>
          {m.net >= 0 ? '+' : ''}
          {money(m.net)}
        </span>
      ),
    },
    {
      key: 'running_balance',
      label: 'Balance',
      num: true,
      render: m => <span className={`font-semibold ${signed(m.running_balance)}`}>{money(m.running_balance)}</span>,
    },
  ]

  const sourceSegments = (d.by_dim ?? [])
    .filter(r => r.amount > 0)
    .map(r => ({ label: r.label, value: r.amount, color: SOURCE_COLOR[r.key] ?? 'rgb(148 163 184)' }))

  const outRows = d.by_dim2 ?? []

  return (
    <div className="space-y-5">
      <KpiGrid>
        <Kpi label="Cash in" value={money(c.cash_in)} delta={delta(c.cash_in, p.cash_in)} highlight />
        <Kpi label="Cash out" value={money(c.cash_out)} delta={delta(c.cash_out, p.cash_out)} invert />
        <Kpi label="Net" value={money(c.net)} delta={delta(c.net, p.net)} />
        <Kpi label="Opening balance" value={money(c.opening_balance)} sub="At period start" />
        <Kpi label="Closing balance" value={money(c.closing_balance)} sub="At period end" />
      </KpiGrid>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2">
          <CashflowTrendCard data={(d.series ?? []) as TrendPoint[]} granularity={d.bucket} />
        </div>
        <MixDonutCard
          title="Cash in by source"
          segments={sourceSegments}
          total={money(c.cash_in)}
          totalLabel="Total cash in"
        />
      </div>

      {outRows.length > 0 && (
        <Section title="Cash out breakdown">
          <Table
            rows={outRows}
            cols={[
              { key: 'label', label: 'Destination', render: r => r.label },
              { key: 'amount', label: 'Amount', num: true, render: r => money(r.amount) },
            ]}
            rowKey={r => r.key}
            empty="No outflows in this period."
          />
        </Section>
      )}

      <Section title="Monthly cashflow">
        <Table rows={d.monthly} cols={cols} rowKey={m => m.month} empty="No cashflow in this period." />
      </Section>
    </div>
  )
}
