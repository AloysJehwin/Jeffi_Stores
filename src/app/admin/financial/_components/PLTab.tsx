'use client'

import { useState, useEffect } from 'react'
import DatePicker from '@/components/ui/DatePicker'
import { PLMonthModal } from './pl-modals'
import { SourceBar } from './SourceBar'
import { Skeleton, SummaryCard, btnPrimary, labelCls, formatINR, thCls, thRight } from './shared'

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
          <div className="pb-0.5">
            <button className={btnPrimary} onClick={load}>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>
      </div>

      {!data ? (
        <Skeleton rows={6} />
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard
              label="Gross Revenue"
              value={formatINR(data.totals.revenue)}
              sub={`${data.totals.order_count} orders`}
            />
            <SummaryCard label="Refunds" value={formatINR(data.totals.refunds)} />
            <SummaryCard label="Net Revenue" value={formatINR(data.totals.net_revenue)} />
            <SummaryCard label="Gross Margin" value={`${data.totals.gross_margin_pct}%`} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard label="COGS" value={formatINR(data.totals.cogs)} />
            <SummaryCard label="Gross Profit" value={formatINR(data.totals.gross_profit)} />
            <SummaryCard label="Op. Expenses" value={formatINR(data.totals.operating_expenses)} />
            <SummaryCard label="Op. Profit" value={formatINR(data.totals.operating_profit)} />
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

          {data.monthly.length === 0 ? (
            <p className="text-foreground-secondary text-sm text-center py-10">No paid orders in this period</p>
          ) : (
            <>
              {selectedMonth && (
                <PLMonthModal m={selectedMonth} all={data.monthly} onClose={() => setSelectedMonth(null)} />
              )}
              {/* Desktop table */}
              <div className="hidden lg:block overflow-x-auto rounded-xl border border-border-default">
                <table className="w-full text-sm">
                  <thead className="bg-surface-secondary">
                    <tr>
                      <th className={thCls}>Month</th>
                      <th className={thRight}>Revenue</th>
                      <th className={thRight}>Refunds</th>
                      <th className={thRight}>Net Rev.</th>
                      <th className={thRight}>COGS</th>
                      <th className={thRight}>Gross Profit</th>
                      <th className={thCls}>Margin</th>
                      <th className={thRight}>Op. Exp.</th>
                      <th className={thRight}>Op. Profit</th>
                      <th className={thRight}>GST</th>
                      <th className={thRight}>Orders</th>
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
                              {new Date(m.month + '-01').toLocaleDateString('en-IN', {
                                month: 'short',
                                year: 'numeric',
                              })}
                            </div>
                          </button>
                          <div className="mt-1 w-24">
                            <SourceBar
                              online={m.revenue_online}
                              business={m.revenue_business}
                              cashSale={m.revenue_cash_sale}
                              offline={m.revenue_offline}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-foreground">{formatINR(m.revenue)}</td>
                        <td className="px-4 py-3 text-right text-red-600 dark:text-red-400 text-xs">
                          {m.refunds > 0 ? `-${formatINR(m.refunds)}` : '—'}
                        </td>
                        <td className="px-4 py-3 text-right text-foreground font-medium">{formatINR(m.net_revenue)}</td>
                        <td className="px-4 py-3 text-right text-foreground-secondary">{formatINR(m.cogs)}</td>
                        <td className="px-4 py-3 text-right text-foreground">{formatINR(m.gross_profit)}</td>
                        <td className="px-4 py-3 min-w-[100px]">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-surface-secondary rounded-full h-2 overflow-hidden">
                              <div
                                className="h-full bg-green-500 rounded-full"
                                style={{ width: `${Math.min(m.gross_margin_pct, 100)}%` }}
                              />
                            </div>
                            <span className="text-xs text-foreground-secondary w-10 text-right">
                              {m.gross_margin_pct}%
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-foreground-secondary">
                          {formatINR(m.operating_expenses)}
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-semibold ${m.operating_profit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
                        >
                          {formatINR(m.operating_profit)}
                        </td>
                        <td className="px-4 py-3 text-right text-foreground-secondary text-xs">
                          {formatINR(m.tax_collected)}
                        </td>
                        <td className="px-4 py-3 text-right text-foreground-secondary">{m.order_count}</td>
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
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-foreground text-sm underline decoration-dotted underline-offset-2">
                        {new Date(m.month + '-01').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                      </p>
                      <span className="text-xs text-foreground-secondary">{m.order_count} orders</span>
                    </div>
                    <SourceBar
                      online={m.revenue_online}
                      business={m.revenue_business}
                      cashSale={m.revenue_cash_sale}
                      offline={m.revenue_offline}
                    />
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-foreground-secondary">Revenue</span>
                        <span className="font-medium text-foreground">{formatINR(m.revenue)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-foreground-secondary">Refunds</span>
                        <span className="text-red-500">{m.refunds > 0 ? `-${formatINR(m.refunds)}` : '—'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-foreground-secondary">Net Revenue</span>
                        <span className="font-medium text-foreground">{formatINR(m.net_revenue)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-foreground-secondary">COGS</span>
                        <span className="text-foreground-secondary">{formatINR(m.cogs)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-foreground-secondary">Gross Profit</span>
                        <span className="font-medium text-foreground">{formatINR(m.gross_profit)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-foreground-secondary">Op. Expenses</span>
                        <span className="text-foreground-secondary">{formatINR(m.operating_expenses)}</span>
                      </div>
                      <div className="flex justify-between col-span-2">
                        <span className="text-foreground-secondary">Op. Profit</span>
                        <span
                          className={`font-semibold ${m.operating_profit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
                        >
                          {formatINR(m.operating_profit)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 pt-0.5">
                      <div className="flex-1 bg-surface-secondary rounded-full h-1.5 overflow-hidden">
                        <div
                          className="h-full bg-green-500 rounded-full"
                          style={{ width: `${Math.min(m.gross_margin_pct, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-foreground-secondary w-12 text-right">
                        {m.gross_margin_pct}% margin
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
