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
import { useCanWrite, useHasScope } from '@/contexts/AdminScopesContext'
import { PACKING_DEFAULT_DAYS, PACKING_FIELDS, PACKING_SEARCH } from '@/lib/filters/fields/packing-slips'
import PackingSlipsMobileList from './_components/PackingSlipsMobileList'
import {
  DOC_META,
  DOC_ORDER,
  DOWNLOAD_ICON,
  DocumentSetPicker,
  Icon,
  docAvailable,
  downloadDocuments,
  useDocumentSet,
  type DocKey,
  type DocOrder,
} from './_components/order-documents'

interface Order extends DocOrder {
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
  // `${orderId}:${doc|'set'}` while that row's download is being built.
  const [busy, setBusy] = useState<string | null>(null)
  const toast = useActionToast()
  const canOrders = useHasScope('orders:read')
  const canBulk = useCanWrite('packing_slips')
  const [docSet, setDocSet] = useDocumentSet(canOrders)
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
    if (selectedIds.size === 0) return
    // Per-order grouping follows the list order; selections no longer loaded go last.
    const loaded = orders.filter(o => selectedIds.has(o.id)).map(o => o.id)
    const ids = [...loaded, ...[...selectedIds].filter(id => !loaded.includes(id))]
    setDownloading(true)
    try {
      const skipped = await downloadDocuments({ orderIds: ids }, docSet)
      if (skipped) toast.warning(`Downloaded ${ids.length} orders, but ${skipped}.`)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setDownloading(false)
    }
  }

  async function downloadRow(order: Order, docs: DocKey[] | 'set') {
    const key = `${order.id}:${docs === 'set' ? 'set' : docs.join(',')}`
    setBusy(key)
    try {
      const skipped = await downloadDocuments({ orderId: order.id }, docs === 'set' ? docSet : { ...docSet, docs })
      if (skipped) toast.warning(`Downloaded #${order.order_number}, but ${skipped}.`)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(null)
    }
  }

  const rowDocs = DOC_ORDER.filter(d => canOrders || d === 'packing_slip')
  const setLabel = docSet.docs.map(d => DOC_META[d].label.toLowerCase()).join(' + ')

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-5">
        <PageHeader title="Packing Slips" description="Packing slips, shipping labels and invoices for each order" />
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
          <div className="flex flex-wrap items-center gap-2">
            <DocumentSetPicker value={docSet} onChange={setDocSet} canOrders={canOrders} />
            {canBulk && selectedIds.size > 0 && (
              <button
                onClick={downloadBulk}
                disabled={downloading}
                title={`Download ${setLabel} for the selected orders as one PDF`}
                className="inline-flex items-center gap-2 px-4 h-control-sm bg-secondary-500 hover:bg-secondary-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
              >
                <Icon d={DOWNLOAD_ICON} />
                {downloading ? 'Generating…' : `Download Selected (${selectedIds.size})`}
              </button>
            )}
          </div>
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
                docs={rowDocs}
                setLabel={docSet.docs.length > 1 ? setLabel : null}
                setReady={o => docSet.docs.some(d => docAvailable(o, d))}
                onDownload={downloadRow}
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
                    <th className="px-4 py-3 text-center font-semibold text-foreground-secondary">Documents</th>
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
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1.5">
                          {rowDocs.map(doc => {
                            const ok = docAvailable(order, doc)
                            return (
                              <button
                                key={doc}
                                type="button"
                                onClick={() => downloadRow(order, [doc])}
                                disabled={!ok || busy === `${order.id}:${doc}`}
                                title={ok ? `Download ${DOC_META[doc].label.toLowerCase()}` : DOC_META[doc].unavailable}
                                aria-label={`${DOC_META[doc].label} for #${order.order_number}`}
                                className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-border-default text-foreground-secondary hover:bg-surface-secondary hover:text-foreground transition-colors disabled:opacity-35 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                              >
                                <Icon d={DOC_META[doc].icon} />
                              </button>
                            )
                          })}
                          <button
                            type="button"
                            onClick={() => downloadRow(order, 'set')}
                            disabled={!docSet.docs.some(d => docAvailable(order, d)) || busy === `${order.id}:set`}
                            title={`Download ${setLabel} as one PDF`}
                            aria-label={`Download chosen documents for #${order.order_number}`}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-secondary-500 hover:bg-secondary-600 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Icon d={DOWNLOAD_ICON} />
                          </button>
                        </div>
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
