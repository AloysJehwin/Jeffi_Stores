'use client'

import { useState, useCallback, useEffect } from 'react'
import Link from 'next/link'
import { ap } from '@/lib/admin-path'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { Skeleton, SummaryCard, formatDate, formatINR } from './shared'

export function CodRemittanceTab() {
  const [statusFilter, setStatusFilter] = useState<'cod_collected' | 'cod_pending' | 'paid' | 'all'>('cod_collected')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [marking, setMarking] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const canWrite = useCanWrite('financial:write')

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/admin/financial/cod-remittance?status=${statusFilter}`)
      .then(r => r.json())
      .then(j => {
        setData(j)
        setSelected(new Set())
      })
      .finally(() => setLoading(false))
  }, [statusFilter])

  useEffect(() => {
    load()
  }, [load])

  async function markRemitted(ids: string[]) {
    setMarking(true)
    setMsg(null)
    const res = await fetch('/api/admin/financial/cod-remittance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderIds: ids }),
    })
    const j = await res.json()
    setMarking(false)
    if (j.success) {
      setMsg(`Marked ${j.marked} order(s) as remitted.`)
      load()
    }
  }

  const orders: any[] = data?.orders ?? []
  const summary = data?.summary ?? {}
  const weeks: any[] = data?.weeks ?? []

  const FILTERS: { value: typeof statusFilter; label: string }[] = [
    { value: 'cod_collected', label: 'Collected' },
    { value: 'cod_pending', label: 'Pending' },
    { value: 'paid', label: 'Remitted' },
    { value: 'all', label: 'All' },
  ]

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryCard
          label="Pending Collection"
          value={String(summary.cod_pending ?? 0)}
          sub="orders awaiting delivery"
        />
        <SummaryCard
          label="Collected, Not Remitted"
          value={String(summary.cod_collected ?? 0)}
          sub={`${formatINR(summary.cod_collected_amount ?? 0)} to remit`}
        />
        <SummaryCard
          label="Total Collected"
          value={formatINR(summary.total_collected_amount ?? 0)}
          sub="across all collected orders"
        />
      </div>

      {/* Filter bar + bulk action */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-border-default overflow-hidden text-sm">
          {FILTERS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setStatusFilter(value)}
              className={`px-4 py-1.5 transition-colors font-medium ${statusFilter === value ? 'bg-secondary-500 text-white' : 'bg-surface text-foreground-secondary hover:bg-surface-secondary'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {canWrite && selected.size > 0 && (
          <button
            onClick={() => markRemitted(Array.from(selected))}
            disabled={marking}
            className="px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
          >
            {marking ? 'Marking…' : `Mark ${selected.size} selected as Remitted`}
          </button>
        )}
        {msg && <span className="text-sm text-green-600 dark:text-green-400 font-medium">{msg}</span>}
      </div>

      {loading && <Skeleton rows={6} />}

      {/* Grouped by delivery week — Collected view */}
      {!loading && statusFilter === 'cod_collected' && weeks.length === 0 && (
        <div className="rounded-xl border border-border-default px-6 py-12 text-center text-foreground-muted text-sm">
          No collected COD orders pending remittance.
        </div>
      )}

      {!loading && statusFilter === 'cod_collected' && weeks.length > 0 && (
        <div className="space-y-4">
          {weeks.map((week: any) => (
            <div key={week.weekStart} className="rounded-xl border border-border-default overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 bg-surface-secondary border-b border-border-default">
                <div>
                  <span className="font-semibold text-sm text-foreground">{week.weekLabel}</span>
                  <span className="ml-3 text-xs text-foreground-muted">
                    {week.orders.length} orders · {formatINR(week.total)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {canWrite && (
                    <>
                      <button
                        onClick={() =>
                          setSelected(prev => {
                            const next = new Set(prev)
                            week.orders.forEach((o: any) => next.add(o.id))
                            return next
                          })
                        }
                        className="text-xs text-secondary-500 hover:underline font-medium"
                      >
                        Select all
                      </button>
                      <button
                        onClick={() => markRemitted(week.orders.map((o: any) => o.id))}
                        disabled={marking}
                        className="text-xs px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50 font-medium transition-colors"
                      >
                        {marking ? '…' : 'Mark week remitted'}
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-secondary/50">
                    <tr className="text-xs font-medium text-foreground-secondary uppercase tracking-wide">
                      <th className="px-4 py-2 w-8">
                        {canWrite && (
                          <input
                            type="checkbox"
                            checked={week.orders.length > 0 && week.orders.every((o: any) => selected.has(o.id))}
                            onChange={e =>
                              setSelected(prev => {
                                const next = new Set(prev)
                                week.orders.forEach((o: any) => (e.target.checked ? next.add(o.id) : next.delete(o.id)))
                                return next
                              })
                            }
                          />
                        )}
                      </th>
                      <th className="px-4 py-2 text-left">Order</th>
                      <th className="px-4 py-2 text-left">Customer</th>
                      <th className="px-4 py-2 text-right">Amount</th>
                      <th className="px-4 py-2 text-left">Delivered</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default">
                    {week.orders.map((o: any) => (
                      <tr key={o.id} className="hover:bg-surface-secondary/40 transition-colors">
                        <td className="px-4 py-2.5">
                          {canWrite && (
                            <input
                              type="checkbox"
                              checked={selected.has(o.id)}
                              onChange={e =>
                                setSelected(prev => {
                                  const next = new Set(prev)
                                  e.target.checked ? next.add(o.id) : next.delete(o.id)
                                  return next
                                })
                              }
                            />
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <Link
                            href={`/admin/orders/${o.id}`}
                            className="text-secondary-500 hover:underline font-mono text-xs font-medium"
                          >
                            #{o.order_number}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5 text-foreground-secondary text-sm">{o.customer_name}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-foreground">
                          {formatINR(parseFloat(o.total_amount))}
                        </td>
                        <td className="px-4 py-2.5 text-foreground-muted text-xs">
                          {o.delivered_at ? formatDate(o.delivered_at) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Flat table — Pending / Remitted / All views */}
      {!loading && statusFilter !== 'cod_collected' && (
        <div className="rounded-xl border border-border-default overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-secondary">
                <tr className="text-xs font-medium text-foreground-secondary uppercase tracking-wide">
                  <th className="px-4 py-3 text-left">Order</th>
                  <th className="px-4 py-3 text-left">Customer</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Delivered</th>
                  <th className="px-4 py-3 text-left">Remitted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {orders.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-foreground-muted">
                      No orders found.
                    </td>
                  </tr>
                )}
                {orders.map((o: any) => (
                  <tr key={o.id} className="hover:bg-surface-secondary/40 transition-colors">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/admin/orders/${o.id}`}
                        className="text-secondary-500 hover:underline font-mono text-xs font-medium"
                      >
                        #{o.order_number}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-foreground-secondary">{o.customer_name}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-foreground">
                      {formatINR(parseFloat(o.total_amount))}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          o.payment_status === 'cod_pending'
                            ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                            : o.payment_status === 'cod_collected'
                              ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                              : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        }`}
                      >
                        {o.payment_status === 'cod_pending'
                          ? 'Pending'
                          : o.payment_status === 'cod_collected'
                            ? 'Collected'
                            : 'Remitted'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-foreground-muted text-xs">
                      {o.delivered_at ? formatDate(o.delivered_at) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-foreground-muted text-xs">
                      {o.cod_remitted_at ? formatDate(o.cod_remitted_at) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
