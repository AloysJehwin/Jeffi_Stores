'use client'

import { useState, useEffect } from 'react'
import DatePicker from '@/components/ui/DatePicker'
import { Card, DataTable, EmptyState, type DataCol } from '@/components/admin/kit'
import { PLMonthModal } from './pl-modals'
import { SourceBar, SourceLegend } from './SourceBar'
import { Skeleton, SummaryCard, btnPrimary, labelCls, formatINR } from './shared'

const monthLabel = (m: string) => new Date(m + '-01').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
const signed = (v: number) => (v >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400')

function MarginBar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <div className="flex-1 bg-surface-secondary rounded-full h-2 overflow-hidden">
        <div className="h-full bg-green-500 rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-xs text-foreground-muted w-10 text-right tabular-nums">{pct}%</span>
    </div>
  )
}

const COLS: DataCol<any>[] = [
  {
    key: 'month',
    label: 'Month',
    sort: m => m.month,
    render: m => (
      <div className="min-w-[110px]">
        <span className="font-medium text-foreground underline decoration-dotted underline-offset-2">{monthLabel(m.month)}</span>
        <div className="mt-1 w-24">
          <SourceBar online={m.revenue_online} business={m.revenue_business} cashSale={m.revenue_cash_sale} offline={m.revenue_offline} />
        </div>
      </div>
    ),
  },
  { key: 'revenue', label: 'Revenue', num: true, sort: m => m.revenue, render: m => <span className="text-foreground">{formatINR(m.revenue)}</span> },
  { key: 'refunds', label: 'Refunds', num: true, sort: m => m.refunds, render: m => <span className="text-xs text-red-600 dark:text-red-400">{m.refunds > 0 ? `-${formatINR(m.refunds)}` : '-'}</span> },
  { key: 'net', label: 'Net Rev.', num: true, sort: m => m.net_revenue, render: m => <span className="font-medium text-foreground">{formatINR(m.net_revenue)}</span> },
  { key: 'cogs', label: 'COGS', num: true, sort: m => m.cogs, render: m => <span className="text-foreground-secondary">{formatINR(m.cogs)}</span> },
  { key: 'gp', label: 'Gross Profit', num: true, sort: m => m.gross_profit, render: m => <span className="text-foreground">{formatINR(m.gross_profit)}</span> },
  { key: 'margin', label: 'Margin', sort: m => m.gross_margin_pct, render: m => <MarginBar pct={m.gross_margin_pct} /> },
  { key: 'opex', label: 'Op. Exp.', num: true, sort: m => m.operating_expenses, render: m => <span className="text-foreground-secondary">{formatINR(m.operating_expenses)}</span> },
  { key: 'op', label: 'Op. Profit', num: true, sort: m => m.operating_profit, render: m => <span className={`font-semibold ${signed(m.operating_profit)}`}>{formatINR(m.operating_profit)}</span> },
  { key: 'gst', label: 'GST', num: true, sort: m => m.tax_collected, render: m => <span className="text-xs text-foreground-secondary">{formatINR(m.tax_collected)}</span> },
  { key: 'orders', label: 'Orders', num: true, sort: m => m.order_count, render: m => <span className="text-foreground-secondary">{m.order_count}</span> },
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
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-foreground text-sm underline decoration-dotted underline-offset-2">{monthLabel(m.month)}</p>
        <span className="text-xs text-foreground-muted">{m.order_count} orders</span>
      </div>
      <SourceBar online={m.revenue_online} business={m.revenue_business} cashSale={m.revenue_cash_sale} offline={m.revenue_offline} />
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs tabular-nums">
        {row('Revenue', <span className="font-medium text-foreground">{formatINR(m.revenue)}</span>)}
        {row('Refunds', <span className="text-red-500">{m.refunds > 0 ? `-${formatINR(m.refunds)}` : '-'}</span>)}
        {row('Net Revenue', <span className="font-medium text-foreground">{formatINR(m.net_revenue)}</span>)}
        {row('COGS', <span className="text-foreground-secondary">{formatINR(m.cogs)}</span>)}
        {row('Gross Profit', <span className="font-medium text-foreground">{formatINR(m.gross_profit)}</span>)}
        {row('Op. Expenses', <span className="text-foreground-secondary">{formatINR(m.operating_expenses)}</span>)}
        <div className="flex justify-between col-span-2">
          <span className="text-foreground-secondary">Op. Profit</span>
          <span className={`font-semibold ${signed(m.operating_profit)}`}>{formatINR(m.operating_profit)}</span>
        </div>
      </div>
      <MarginBar pct={m.gross_margin_pct} />
    </div>
  )
}

export function PLTab({ initialData }: { initialData: any }) {
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
    const res = await fetch(`/api/admin/financial/pl?from=${from}&to=${to}`)
    const json = await res.json()
    setData(json)
    setLoading(false)
  }

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
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard label="Gross Revenue" value={formatINR(data.totals.revenue)} sub={`${data.totals.order_count} orders`} />
            <SummaryCard label="Refunds" value={formatINR(data.totals.refunds)} />
            <SummaryCard label="Net Revenue" value={formatINR(data.totals.net_revenue)} />
            <SummaryCard label="Gross Margin" value={`${data.totals.gross_margin_pct}%`} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard label="COGS" value={formatINR(data.totals.cogs)} />
            <SummaryCard label="Gross Profit" value={formatINR(data.totals.gross_profit)} />
            <SummaryCard label="Op. Expenses" value={formatINR(data.totals.operating_expenses)} />
            <SummaryCard label="Op. Profit" value={formatINR(data.totals.operating_profit)} />
          </div>

          {data.monthly.length === 0 ? (
            <EmptyState title="No paid orders in this period" />
          ) : (
            <>
              {selectedMonth && <PLMonthModal m={selectedMonth} all={data.monthly} onClose={() => setSelectedMonth(null)} />}
              <Card title="Monthly P&L" hint="Click a month for the breakdown" action={<SourceLegend />} flush>
                <DataTable<any>
                  bare
                  rows={data.monthly}
                  cols={COLS}
                  rowKey={m => m.month}
                  onRowClick={setSelectedMonth}
                  mobileCard={m => (
                    <button type="button" className="block w-full text-left" onClick={() => setSelectedMonth(m)}>
                      <MonthCard m={m} />
                    </button>
                  )}
                />
              </Card>
            </>
          )}
        </>
      )}
    </div>
  )
}
