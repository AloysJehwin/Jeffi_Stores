'use client'

import Link from 'next/link'
import { Banner, Kpi, KpiGrid, Section, Table, count, money, type Col } from '@/components/admin/channels/ui'
import { OverviewSkeleton, useOverviewData } from '@/components/admin/overview/kit'
import { KeyedTrendCard, MixDonutCard, type TrendPoint } from '@/components/admin/kit/charts'
import { delta } from '@/lib/overview/period'
import { ap } from '@/lib/shared/admin-path'
import {
  FinancePeriodBar,
  useFinancePeriod,
  type FinanceBucket,
  type FinanceOverviewContract,
} from './finance'

type Totals = { inflow: number; outflow: number; net: number; count: number }
type MethodRow = { method: string; inflow: number; outflow: number; count: number }
type PartyRow = {
  party: string
  party_type: 'customer' | 'supplier' | 'cash' | 'order'
  user_id: string | null
  supplier_id: string | null
  expense_id: string | null
  inflow: number
  outflow: number
  count: number
}
type TxnOverview = FinanceOverviewContract<Totals> & {
  series: TrendPoint[]
  bucket: FinanceBucket
  by_method: MethodRow[]
  by_party: PartyRow[]
}

const METHOD_LABEL: Record<string, string> = {
  bank_transfer: 'Bank transfer',
  upi: 'UPI',
  cash: 'Cash',
  cheque: 'Cheque',
  card: 'Card',
  online: 'Online',
  cod: 'Cash on delivery',
  wallet: 'Wallet',
  unknown: 'Unknown',
}
const METHOD_COLOR: Record<string, string> = {
  bank_transfer: 'rgb(59 130 246)',
  upi: 'rgb(16 185 129)',
  cash: 'rgb(234 179 8)',
  cheque: 'rgb(168 85 247)',
  card: 'rgb(236 72 153)',
  online: 'rgb(14 165 233)',
  cod: 'rgb(249 115 22)',
}
const FALLBACK = 'rgb(148 163 184)'
const SERIES_KEYS = ['inflow', 'outflow'] as const
const SERIES_LABELS = { inflow: 'Inflow', outflow: 'Outflow' } as const
const KIND_LABEL: Record<PartyRow['party_type'], string> = {
  customer: 'Customer',
  supplier: 'Supplier',
  cash: 'Cash sale',
  order: 'Guest order',
}

const labelOf = (m: string) =>
  METHOD_LABEL[m] ?? m.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

function partyHref(r: PartyRow): string | null {
  if (r.party_type === 'customer' && r.user_id) return `/admin/customers/${r.user_id}/view`
  if (r.party_type === 'supplier' && r.supplier_id) return `/admin/suppliers/${r.supplier_id}/view`
  if (r.party_type === 'supplier' && r.expense_id) return `/admin/financial/payables/${r.expense_id}/view`
  return null
}

export function TransactionsTab() {
  const { range } = useFinancePeriod()
  const { data, error, loading, reload } = useOverviewData<TxnOverview>(
    `/api/admin/financial/transactions?from=${range.from}&to=${range.to}`
  )
  return (
    <div className="space-y-5">
      <FinancePeriodBar onRefresh={reload} busy={loading} />
      {error && <Banner ok={false}>{error}</Banner>}
      {loading && !data ? <OverviewSkeleton /> : data && <Body d={data} />}
    </div>
  )
}

function Body({ d }: { d: TxnOverview }) {
  const c = d.current
  const p = d.previous
  const methodSegments = d.by_method
    .map(r => ({
      label: labelOf(r.method),
      value: r.inflow + r.outflow,
      color: METHOD_COLOR[r.method] ?? FALLBACK,
    }))
    .filter(s => s.value > 0)

  const methodCols: Col<MethodRow>[] = [
    { key: 'method', label: 'Method', render: r => labelOf(r.method), sort: r => r.method },
    { key: 'inflow', label: 'Inflow', num: true, render: r => money(r.inflow), sort: r => r.inflow },
    { key: 'outflow', label: 'Outflow', num: true, render: r => money(r.outflow), sort: r => r.outflow },
    {
      key: 'net',
      label: 'Net',
      num: true,
      render: r => money(r.inflow - r.outflow),
      sort: r => r.inflow - r.outflow,
    },
    { key: 'count', label: 'Txns', num: true, render: r => count(r.count), sort: r => r.count },
  ]
  const partyCols: Col<PartyRow>[] = [
    {
      key: 'party',
      label: 'Counterparty',
      sort: r => r.party,
      render: r => {
        const href = partyHref(r)
        return href ? (
          <Link href={ap(href)} className="hover:text-accent-500 hover:underline">
            {r.party}
          </Link>
        ) : (
          <span>{r.party}</span>
        )
      },
    },
    { key: 'kind', label: 'Kind', render: r => KIND_LABEL[r.party_type] ?? r.party_type },
    { key: 'inflow', label: 'Inflow', num: true, render: r => money(r.inflow), sort: r => r.inflow },
    { key: 'outflow', label: 'Outflow', num: true, render: r => money(r.outflow), sort: r => r.outflow },
    { key: 'count', label: 'Txns', num: true, render: r => count(r.count), sort: r => r.count },
  ]

  const partyKey = (r: PartyRow) =>
    `${r.party_type}:${r.user_id ?? r.supplier_id ?? r.expense_id ?? r.party}`

  return (
    <div className="space-y-5">
      <KpiGrid>
        <Kpi
          label="Inflow"
          value={money(c.inflow)}
          delta={delta(c.inflow, p.inflow)}
          sub="Payments received"
          highlight
        />
        <Kpi
          label="Outflow"
          value={money(c.outflow)}
          delta={delta(c.outflow, p.outflow)}
          invert
          sub="Payments made"
        />
        <Kpi
          label="Net"
          value={money(c.net)}
          delta={delta(c.net, p.net)}
          sub={c.net >= 0 ? 'Surplus' : 'Deficit'}
        />
        <Kpi label="Transactions" value={count(c.count)} delta={delta(c.count, p.count)} />
      </KpiGrid>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2">
          <KeyedTrendCard
            title="Inflow vs outflow"
            data={d.series}
            keys={[...SERIES_KEYS]}
            labels={SERIES_LABELS}
            granularity={d.bucket}
          />
        </div>
        <MixDonutCard
          title="By method"
          segments={methodSegments}
          total={money(c.inflow + c.outflow)}
          totalLabel="Total movement"
        />
      </div>

      <Section
        title="By method"
        action={
          <CsvAction
            name="methods"
            headers={['Method', 'Inflow', 'Outflow', 'Net', 'Txns']}
            rows={d.by_method.map(r => [
              labelOf(r.method),
              r.inflow,
              r.outflow,
              r.inflow - r.outflow,
              r.count,
            ])}
          />
        }
      >
        <Table
          rows={d.by_method}
          cols={methodCols}
          rowKey={r => r.method}
          empty="No transactions in this period."
        />
      </Section>

      <Section
        title="Top counterparties"
        action={
          <CsvAction
            name="counterparties"
            headers={['Party', 'Kind', 'Inflow', 'Outflow', 'Txns']}
            rows={d.by_party.map(r => [
              r.party,
              KIND_LABEL[r.party_type] ?? r.party_type,
              r.inflow,
              r.outflow,
              r.count,
            ])}
          />
        }
      >
        <Table
          rows={d.by_party}
          cols={partyCols}
          rowKey={partyKey}
          empty="No transactions in this period."
        />
      </Section>
    </div>
  )
}

function CsvAction({
  name,
  headers,
  rows,
}: {
  name: string
  headers: string[]
  rows: (string | number)[][]
}) {
  if (!rows.length) return null
  const download = () => {
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
    const csv = [headers.join(','), ...rows.map(r => r.map(esc).join(','))].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `transactions-${name}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }
  return (
    <button type="button" onClick={download} className="text-xs text-accent-500 hover:underline">
      Export CSV
    </button>
  )
}
