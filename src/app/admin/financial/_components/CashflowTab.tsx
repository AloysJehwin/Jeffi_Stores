'use client'

import { useState, useEffect } from 'react'
import DatePicker from '@/components/ui/DatePicker'
import { CashflowMonthModal } from './pl-modals'
import { SourceBar } from './SourceBar'
import { Skeleton, SummaryCard, btnPrimary, labelCls, formatINR, thCls, thRight } from './shared'

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
          <div className="pb-0.5">
            <button className={btnPrimary} onClick={load}>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>
      </div>

      {!data ? (
        <Skeleton rows={6} />
      ) : data.monthly.length === 0 ? (
        <p className="text-foreground-secondary text-sm text-center py-10">No transactions in this period</p>
      ) : (
        <>
          {selectedMonth && (
            <CashflowMonthModal m={selectedMonth} all={data.monthly} onClose={() => setSelectedMonth(null)} />
          )}
          {/* Summary bar */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <SummaryCard label="Total Cash In" value={formatINR(totals.cash_in)} />
            <SummaryCard label="PO Payments" value={formatINR(totals.po_payments)} />
            <SummaryCard label="Refunds Issued" value={formatINR(totals.refunds_out)} />
            <SummaryCard label="Total Cash Out" value={formatINR(totals.cash_out)} />
            <SummaryCard label="Net" value={formatINR(totals.net)} />
          </div>

          {/* Source legend */}
          <div className="flex flex-wrap gap-3 text-xs text-foreground-secondary">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-blue-500 inline-block" />
              Online
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-purple-500 inline-block" />
              Business
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-green-500 inline-block" />
              Cash Sale
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-orange-400 inline-block" />
              Offline
            </span>
          </div>

          {/* Desktop table */}
          <div className="hidden lg:block overflow-x-auto rounded-xl border border-border-default">
            <table className="w-full text-sm">
              <thead className="bg-surface-secondary">
                <tr>
                  <th className={thCls}>Month</th>
                  <th className={thRight}>Cash In</th>
                  <th className={thRight}>PO Payments</th>
                  <th className={thRight}>Refunds Out</th>
                  <th className={thRight}>Total Out</th>
                  <th className={thRight}>Net</th>
                  <th className={thRight}>Running Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {data.monthly.map((m: any) => (
                  <tr
                    key={m.month}
                    className="hover:bg-surface-secondary/40 transition-colors cursor-pointer"
                    onClick={() => setSelectedMonth(m)}
                  >
                    <td className="px-4 py-3 font-medium text-foreground min-w-[110px]">
                      <button className="text-left hover:text-accent-600 dark:hover:text-accent-400 transition-colors underline decoration-dotted underline-offset-2">
                        <div>
                          {new Date(m.month + '-01').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                        </div>
                      </button>
                      <div className="mt-1 w-24">
                        <SourceBar
                          online={m.cash_in_online}
                          business={m.cash_in_business}
                          cashSale={m.cash_in_cash_sale}
                          offline={m.cash_in_offline}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-green-600 dark:text-green-400 font-medium">
                      {formatINR(m.cash_in)}
                    </td>
                    <td className="px-4 py-3 text-right text-foreground-secondary">
                      {m.po_payments > 0 ? formatINR(m.po_payments) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-foreground-secondary">
                      {m.refunds_out > 0 ? formatINR(m.refunds_out) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-red-600 dark:text-red-400">{formatINR(m.cash_out)}</td>
                    <td
                      className={`px-4 py-3 text-right font-medium ${m.net >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
                    >
                      {m.net >= 0 ? '+' : ''}
                      {formatINR(m.net)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-semibold ${m.running_balance >= 0 ? 'text-foreground' : 'text-red-600 dark:text-red-400'}`}
                    >
                      {formatINR(m.running_balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="lg:hidden rounded-xl border border-border-default divide-y divide-border-default">
            {data.monthly.map((m: any) => (
              <button
                key={m.month}
                className="w-full text-left p-4 space-y-2 hover:bg-surface-secondary/40 transition-colors"
                onClick={() => setSelectedMonth(m)}
              >
                <p className="font-medium text-foreground text-sm underline decoration-dotted underline-offset-2">
                  {new Date(m.month + '-01').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                </p>
                <SourceBar
                  online={m.cash_in_online}
                  business={m.cash_in_business}
                  cashSale={m.cash_in_cash_sale}
                  offline={m.cash_in_offline}
                />
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-foreground-secondary">Cash In</span>
                    <span className="font-medium text-green-600 dark:text-green-400">{formatINR(m.cash_in)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-foreground-secondary">PO Payments</span>
                    <span className="text-foreground-secondary">
                      {m.po_payments > 0 ? formatINR(m.po_payments) : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-foreground-secondary">Refunds Out</span>
                    <span className="text-foreground-secondary">
                      {m.refunds_out > 0 ? formatINR(m.refunds_out) : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-foreground-secondary">Total Out</span>
                    <span className="text-red-600 dark:text-red-400">{formatINR(m.cash_out)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-foreground-secondary">Net</span>
                    <span
                      className={`font-medium ${m.net >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
                    >
                      {m.net >= 0 ? '+' : ''}
                      {formatINR(m.net)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-foreground-secondary">Balance</span>
                    <span
                      className={`font-semibold ${m.running_balance >= 0 ? 'text-foreground' : 'text-red-600 dark:text-red-400'}`}
                    >
                      {formatINR(m.running_balance)}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
