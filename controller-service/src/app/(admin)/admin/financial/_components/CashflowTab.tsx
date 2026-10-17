'use client'

import { useState, useEffect } from 'react'
import DatePicker from '@/components/ui/DatePicker'
import { Card, DataTable, EmptyState, type DataCol } from '@/components/admin/kit'
import { CashflowMonthModal } from './pl-modals'
import { SourceBar, SourceLegend } from './SourceBar'
import { Skeleton, SummaryCard, btnPrimary, labelCls, formatINR } from './shared'

const monthLabel = (m: string) => new Date(m + '-01').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
const green = 'text-green-600 dark:text-green-400'
const red = 'text-red-600 dark:text-red-400'

const COLS: DataCol<any>[] = [
  {
    key: 'month',
    label: 'Month',
    sort: m => m.month,
    render: m => (
      <div className="min-w-[110px]">
        <span className="font-medium text-foreground underline decoration-dotted underline-offset-2">{monthLabel(m.month)}</span>
        <div className="mt-1 w-24">
          <SourceBar online={m.cash_in_online} business={m.cash_in_business} cashSale={m.cash_in_cash_sale} offline={m.cash_in_offline} />
        </div>
      </div>
    ),
  },
  { key: 'in', label: 'Cash In', num: true, sort: m => m.cash_in, render: m => <span className={`font-medium ${green}`}>{formatINR(m.cash_in)}</span> },
  { key: 'po', label: 'PO Payments', num: true, sort: m => m.po_payments, render: m => <span className="text-foreground-secondary">{m.po_payments > 0 ? formatINR(m.po_payments) : '-'}</span> },
  { key: 'rf', label: 'Refunds Out', num: true, sort: m => m.refunds_out, render: m => <span className="text-foreground-secondary">{m.refunds_out > 0 ? formatINR(m.refunds_out) : '-'}</span> },
  { key: 'out', label: 'Total Out', num: true, sort: m => m.cash_out, render: m => <span className={red}>{formatINR(m.cash_out)}</span> },
  {
    key: 'net',
    label: 'Net',
    num: true,
    sort: m => m.net,
    render: m => (
      <span className={`font-medium ${m.net >= 0 ? green : red}`}>
        {m.net >= 0 ? '+' : ''}
        {formatINR(m.net)}
      </span>
    ),
  },
  {
    key: 'bal',
    label: 'Running Balance',
    num: true,
    sort: m => m.running_balance,
    render: m => <span className={`font-semibold ${m.running_balance >= 0 ? 'text-foreground' : red}`}>{formatINR(m.running_balance)}</span>,
  },
]

function MonthCard({ m }: { m: any }) {
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between">
      <span className="text-foreground-secondary">{label}</span>
      {value}
    </div>
  )
  return (
    <div className="w-full text-left p-4 space-y-2 rounded-xl border border-border-default bg-surface-elevated">
      <p className="font-medium text-foreground text-sm underline decoration-dotted underline-offset-2">{monthLabel(m.month)}</p>
      <SourceBar online={m.cash_in_online} business={m.cash_in_business} cashSale={m.cash_in_cash_sale} offline={m.cash_in_offline} />
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs tabular-nums">
        {row('Cash In', <span className={`font-medium ${green}`}>{formatINR(m.cash_in)}</span>)}
        {row('PO Payments', <span className="text-foreground-secondary">{m.po_payments > 0 ? formatINR(m.po_payments) : '-'}</span>)}
        {row('Refunds Out', <span className="text-foreground-secondary">{m.refunds_out > 0 ? formatINR(m.refunds_out) : '-'}</span>)}
        {row('Total Out', <span className={red}>{formatINR(m.cash_out)}</span>)}
        {row(
          'Net',
          <span className={`font-medium ${m.net >= 0 ? green : red}`}>
            {m.net >= 0 ? '+' : ''}
            {formatINR(m.net)}
          </span>
        )}
        {row('Balance', <span className={`font-semibold ${m.running_balance >= 0 ? 'text-foreground' : red}`}>{formatINR(m.running_balance)}</span>)}
      </div>
    </div>
  )
}

export function CashflowTab({ initialData }: { initialData: any }) {
  const now = new Date()
  const fyStart = now.getMonth() >= 3 ? `${now.getFullYear()}-04-01` : `${now.getFullYear() - 1}-04-01`
  const fyEnd = now.getMonth() >= 3 ? `${now.getFullYear() + 1}-03-31` : `${now.getFullYear()}-03-31`

  const [from, setFrom] = useState(fyStart)
  const [to, setTo] = useState(fyEnd)
  const [data, setData] = useState<any>(initialData)
  const [loading, setLoading] = useState(false)
  const [selectedMonth, setSelectedMonth] = useState<any>(null)

  useEffect(() => {
    if (initialData !== null) setData(initialData)
  }, [initialData])

  const load = async () => {
    setLoading(true)
    const res = await fetch(`/api/admin/financial/cashflow?from=${from}&to=${to}`)
    const json = await res.json()
    setData(json)
    setLoading(false)
  }

  const totals = data?.monthly?.reduce(
    (acc: any, m: any) => ({
      cash_in: acc.cash_in + m.cash_in,
      po_payments: acc.po_payments + m.po_payments,
      refunds_out: acc.refunds_out + m.refunds_out,
      cash_out: acc.cash_out + m.cash_out,
      net: acc.net + m.net,
    }),
    { cash_in: 0, po_payments: 0, refunds_out: 0, cash_out: 0, net: 0 }
  )

  return (
    <div className="space-y-5">
      <div className="bg-surface-elevated rounded-xl border border-border-default px-4 py-3">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className={labelCls}>From</label>
            <DatePicker className="w-36" value={from} onChange={setFrom} />
          </div>
          <div>
            <label className={labelCls}>To</label>
            <DatePicker className="w-36" value={to} onChange={setTo} />
          </div>
          <button type="button" className={btnPrimary} onClick={load} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {!data ? (
        <Skeleton rows={6} />
      ) : data.monthly.length === 0 ? (
        <EmptyState title="No transactions in this period" />
      ) : (
        <>
          {selectedMonth && <CashflowMonthModal m={selectedMonth} all={data.monthly} onClose={() => setSelectedMonth(null)} />}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <SummaryCard label="Total Cash In" value={formatINR(totals.cash_in)} />
            <SummaryCard label="PO Payments" value={formatINR(totals.po_payments)} />
            <SummaryCard label="Refunds Issued" value={formatINR(totals.refunds_out)} />
            <SummaryCard label="Total Cash Out" value={formatINR(totals.cash_out)} />
            <SummaryCard label="Net" value={formatINR(totals.net)} />
          </div>

          <Card title="Monthly cashflow" hint="Click a month for the breakdown" action={<SourceLegend />} flush>
            <DataTable<any> bare rows={data.monthly} cols={COLS} rowKey={m => m.month} onRowClick={setSelectedMonth} mobileCard={m => (
                    <button type="button" className="block w-full text-left" onClick={() => setSelectedMonth(m)}>
                      <MonthCard m={m} />
                    </button>
                  )} />
          </Card>
        </>
      )}
    </div>
  )
}
