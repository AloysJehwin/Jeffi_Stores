'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ap } from '@/lib/shared/admin-path'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { EmptyState, InfiniteFooter, badgeCls, fetchJson, useActionToast, useInfiniteList } from '@/components/admin/kit'
import { Skeleton, SummaryCard, formatDate, formatINR, theadCls, tableWrapCls, codTone } from './shared'
import CodRemittanceMobileList from './CodRemittanceMobileList'

const PAGE_SIZE = 50

// Same grouping the API applies, over the pages loaded so far (groups grow as more load).
function groupByWeek(orders: any[]) {
  const weeks: Record<string, { weekLabel: string; weekStart: string; orders: any[]; total: number }> = {}
  for (const o of orders) {
    if (o.payment_status !== 'cod_collected' || !o.delivered_at) continue
    const d = new Date(o.delivered_at)
    const day = d.getDay()
    const mon = new Date(d.setDate(d.getDate() - day + (day === 0 ? -6 : 1)))
    const weekStart = mon.toISOString().slice(0, 10)
    weeks[weekStart] ??= {
      weekLabel: `Week of ${mon.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`,
      weekStart,
      orders: [],
      total: 0,
    }
    weeks[weekStart].orders.push(o)
    weeks[weekStart].total += parseFloat(o.total_amount)
  }
  return Object.values(weeks).sort((a, b) => b.weekStart.localeCompare(a.weekStart))
}

export function CodRemittanceTab() {
  const [statusFilter, setStatusFilter] = useState<'cod_collected' | 'cod_pending' | 'paid' | 'all'>('cod_collected')
  const [summary, setSummary] = useState<any>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [marking, setMarking] = useState(false)
  const canWrite = useCanWrite('financial:write')
  const toast = useActionToast()

  const list = useInfiniteList<any>({
    key: statusFilter,
    pageSize: PAGE_SIZE,
    getKey: o => o.id,
    fetchPage: async (p, signal) => {
      const j = await fetchJson(`/api/admin/financial/cod-remittance?status=${statusFilter}&limit=${PAGE_SIZE}&offset=${(p - 1) * PAGE_SIZE}`, signal)
      if (p === 1) {
        setSummary(j.summary ?? {})
        setSelected(new Set())
      }
      return { rows: j.orders ?? [], total: j.total }
    },
  })
  const loading = list.loading

  async function markRemitted(ids: string[]) {
    setMarking(true)
    const res = await fetch('/api/admin/financial/cod-remittance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderIds: ids }),
    })
    const j = await res.json()
    setMarking(false)
    if (j.success) {
      toast.success(`Marked ${j.marked} order(s) as remitted.`)
      list.reload()
    } else {
      toast.error(j.error || 'Could not mark as remitted.')
    }
  }

  const orders: any[] = list.rows
  const weeks = useMemo(() => groupByWeek(orders), [orders])

  const FILTERS: { value: typeof statusFilter; label: string }[] = [
    { value: 'cod_collected', label: 'Collected' },
    { value: 'cod_pending', label: 'Pending' },
    { value: 'paid', label: 'Remitted' },
    { value: 'all', label: 'All' },
  ]

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
        <div className="flex h-control rounded-lg border border-border-default overflow-hidden text-sm">
          {FILTERS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setStatusFilter(value)}
              type="button"
              className={`h-full px-4 transition-colors font-medium ${statusFilter === value ? 'bg-accent-500 text-white' : 'bg-surface-elevated text-foreground-secondary hover:bg-surface-secondary'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {canWrite && selected.size > 0 && (
          <button
            onClick={() => markRemitted(Array.from(selected))}
            disabled={marking}
            type="button"
            className="control-md bg-green-600 hover:bg-green-700 text-white font-medium disabled:opacity-50 transition-colors"
          >
            {marking ? 'Marking…' : `Mark ${selected.size} selected as Remitted`}
          </button>
        )}
      </div>

      {loading && <Skeleton rows={6} />}

      {/* Grouped by delivery week — Collected view */}
      {!loading && statusFilter === 'cod_collected' && weeks.length === 0 && (
        <EmptyState title="No collected COD orders pending remittance." />
      )}

      {!loading && statusFilter === 'cod_collected' && weeks.length > 0 && (
        <div className="space-y-4">
          {weeks.map((week: any) => (
            <div key={week.weekStart} className={tableWrapCls}>
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-surface-secondary/50 border-b border-border-default">
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
                        type="button"
                        className="text-xs text-accent-500 hover:underline font-medium"
                      >
                        Select all
                      </button>
                      <button
                        onClick={() => markRemitted(week.orders.map((o: any) => o.id))}
                        disabled={marking}
                        type="button"
                        className="control-sm bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 font-medium transition-colors"
                      >
                        {marking ? '…' : 'Mark week remitted'}
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="md:hidden p-3 space-y-3">
                <CodRemittanceMobileList
                  orders={week.orders}
                  canWrite={canWrite}
                  selected={selected}
                  onToggle={id =>
                    setSelected(prev => {
                      const next = new Set(prev)
                      next.has(id) ? next.delete(id) : next.add(id)
                      return next
                    })
                  }
                  onMarkRemitted={markRemitted}
                  marking={marking}
                />
              </div>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className={theadCls}>
                    <tr className="text-xs font-medium text-foreground-muted">
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
                            href={`/admin/orders/${o.id}/view`}
                            className="text-accent-500 hover:underline font-mono text-xs font-medium"
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
        <div className={tableWrapCls}>
          {orders.length > 0 && (
            <div className="md:hidden p-3 space-y-3">
              <CodRemittanceMobileList
                orders={orders}
                canWrite={canWrite}
                selected={selected}
                onToggle={id =>
                  setSelected(prev => {
                    const next = new Set(prev)
                    next.has(id) ? next.delete(id) : next.add(id)
                    return next
                  })
                }
                onMarkRemitted={markRemitted}
                marking={marking}
              />
            </div>
          )}
          {orders.length === 0 && (
            <div className="md:hidden px-4 py-10 text-center text-foreground-muted text-sm">No orders found.</div>
          )}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className={theadCls}>
                <tr className="text-xs font-medium text-foreground-muted">
                  <th className="px-4 py-2.5 text-left">Order</th>
                  <th className="px-4 py-2.5 text-left">Customer</th>
                  <th className="px-4 py-2.5 text-right">Amount</th>
                  <th className="px-4 py-2.5 text-left">Status</th>
                  <th className="px-4 py-2.5 text-left">Delivered</th>
                  <th className="px-4 py-2.5 text-left">Remitted</th>
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
                        href={`/admin/orders/${o.id}/view`}
                        className="text-accent-500 hover:underline font-mono text-xs font-medium"
                      >
                        #{o.order_number}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-foreground-secondary">{o.customer_name}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-foreground">
                      {formatINR(parseFloat(o.total_amount))}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={badgeCls(codTone(o.payment_status))}>
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

      {!loading && <InfiniteFooter shown={orders.length} control={list} noun="orders" />}
    </div>
  )
}
