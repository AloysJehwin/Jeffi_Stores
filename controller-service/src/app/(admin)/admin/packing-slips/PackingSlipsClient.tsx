'use client'

import { useState } from 'react'
import {
  InfiniteFooter,
  ListFilters,
  PageHeader,
  TONE_CLS,
  fetchJson,
  useActionToast,
  useFilterQuery,
  useInfiniteList,
} from '@/components/admin/kit'
import { ap } from '@/lib/shared/admin-path'
import { PACKING_DEFAULT_DAYS, PACKING_FIELDS, PACKING_SEARCH } from '@/lib/filters/fields/packing-slips'
import PackingSlipsMobileList from './_components/PackingSlipsMobileList'

interface Order {
  id: string
  order_number: string
  customer_name: string
  created_at: string
  status: string
  total_amount: number
}

const STATUS_COLORS: Record<string, string> = {
  pending: TONE_CLS.amber,
  confirmed: TONE_CLS.blue,
  processing: TONE_CLS.blue,
  shipped: TONE_CLS.blue,
  delivered: TONE_CLS.green,
  granted: TONE_CLS.green,
  cancelled: TONE_CLS.red,
}

function statusLabel(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export default function PackingSlipsClient({ tabs }: { tabs?: React.ReactNode }) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [downloading, setDownloading] = useState(false)
  const toast = useActionToast()
  // The list filters live in the URL; from / to are the order date (without them, the last 30 days).
  const filters = useFilterQuery(PACKING_FIELDS)

  const PAGE_SIZE = 25
  const list = useInfiniteList<Order>({
    key: filters,
    pageSize: PAGE_SIZE,
    getKey: o => o.id,
    fetchPage: async (page, signal) => {
      const params = new URLSearchParams(filters)
      params.set('page', String(page))
      params.set('pageSize', String(PAGE_SIZE))
      const data = await fetchJson(`/api/admin/packing-slips/list?${params}`, signal)
      return { rows: data.orders || [], total: data.total ?? null }
    },
  })
  const orders = list.rows
  const windowed = !/(^|&)(from|to|search)=/.test(filters)
  const error = orders.length ? '' : list.error || ''

  // Select-all covers the loaded rows only.
  const allSelected = orders.length > 0 && orders.every(o => selectedIds.has(o.id))

  function toggleAll() {
    setSelectedIds(prev => {
      const next = new Set(prev)
      orders.forEach(o => (allSelected ? next.delete(o.id) : next.add(o.id)))
      return next
    })
  }

  function toggleOne(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function downloadBulk() {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    setDownloading(true)
    try {
      const res = await fetch('/api/admin/packing-slips/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_ids: ids }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Download failed')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `packing-slips-${new Date().toISOString().slice(0, 10)}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-5">
        <PageHeader title="Packing Slips" description="Download packing slips to attach to parcels" />
      </div>

      {tabs}

      <div className="mb-6 space-y-2">
        <ListFilters entity="packing_slips" fields={PACKING_FIELDS} search={PACKING_SEARCH} noun="Orders" tab="slips" exportable />
        {windowed && (
          <p className="text-xs text-foreground-muted">
            Showing orders from the last {PACKING_DEFAULT_DAYS} days. Pick an order date or search to see older ones.
          </p>
        )}
      </div>

      {error && (
        <div className="mb-4 bg-red-500/5 border border-red-500/40 text-red-600 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="bg-surface-elevated rounded-xl border border-border-default">
        <div className="px-6 py-4 border-b border-border-default flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-foreground">
            Orders
            <span className="ml-2 text-sm font-normal text-foreground-muted">
              {list.total != null && list.total > orders.length ? `${orders.length} of ${list.total}` : orders.length}
            </span>
          </h2>
          {selectedIds.size > 0 && (
            <button
              onClick={downloadBulk}
              disabled={downloading}
              className="inline-flex items-center gap-2 px-4 h-control-sm bg-secondary-500 hover:bg-secondary-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
              {downloading ? 'Generating…' : `Download Selected (${selectedIds.size})`}
            </button>
          )}
        </div>

        {orders.length === 0 ? (
          <div className="px-6 py-12 text-center text-foreground-muted text-sm">
            {list.loading ? 'Loading…' : filters ? 'No orders match the current filters.' : 'No orders found for the selected date range.'}
          </div>
        ) : (
          <>
            <div className="lg:hidden p-4 pt-0 space-y-3">
              <PackingSlipsMobileList
                orders={orders}
                statusColors={STATUS_COLORS}
                statusLabel={statusLabel}
                selectedIds={selectedIds}
                onToggleOne={toggleOne}
              />
            </div>
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-default bg-surface">
                    <th className="px-4 py-3 text-left w-10">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        aria-label="Select all loaded orders"
                        title="Select all loaded orders"
                        className="rounded border-border-default"
                      />
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-foreground-secondary">Order #</th>
                    <th className="px-4 py-3 text-left font-semibold text-foreground-secondary">Customer</th>
                    <th className="px-4 py-3 text-left font-semibold text-foreground-secondary">Date</th>
                    <th className="px-4 py-3 text-left font-semibold text-foreground-secondary">Status</th>
                    <th className="px-4 py-3 text-right font-semibold text-foreground-secondary">Total</th>
                    <th className="px-4 py-3 text-center font-semibold text-foreground-secondary">Slip</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-default">
                  {orders.map(order => (
                    <tr key={order.id} className="hover:bg-surface transition-colors">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(order.id)}
                          onChange={() => toggleOne(order.id)}
                          className="rounded border-border-default"
                        />
                      </td>
                      <td className="px-4 py-3 font-mono">
                        <a
                          href={ap(`/admin/orders/${order.id}/view`)}
                          className="text-foreground font-medium hover:text-accent-500 hover:underline transition-colors"
                        >
                          #{order.order_number}
                        </a>
                      </td>
                      <td className="px-4 py-3 text-foreground">{order.customer_name || '—'}</td>
                      <td className="px-4 py-3 text-foreground-secondary">
                        {new Date(order.created_at).toLocaleDateString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[order.status] || 'bg-surface-secondary text-foreground-secondary'}`}
                        >
                          {statusLabel(order.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-foreground font-medium">
                        ₹
                        {Number(order.total_amount).toLocaleString('en-IN', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <a
                          href={`/api/admin/packing-slips/${order.id}`}
                          download
                          title="Download Packing Slip"
                          className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-border-default text-foreground-secondary hover:bg-surface-secondary hover:text-foreground transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                            />
                          </svg>
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="px-4 pb-4">
          <InfiniteFooter shown={orders.length} control={list} noun="orders" />
        </div>
      </div>
    </div>
  )
}
