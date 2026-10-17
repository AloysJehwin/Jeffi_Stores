'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { InfiniteFooter, PageHeader, TONE_CLS, fetchJson, useActionToast, useInfiniteList } from '@/components/admin/kit'
import { useSearchParams, useRouter } from 'next/navigation'
import AdminSelect from '@/components/admin/AdminSelect'
import DatePicker from '@/components/ui/DatePicker'
import { ap } from '@/lib/shared/admin-path'
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

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'processing', label: 'Processing' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
]

function statusLabel(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export default function PackingSlipsClient({ tabs }: { tabs?: React.ReactNode }) {
  const searchParams = useSearchParams()
  const router = useRouter()

  const [fromDate, setFromDate] = useState(searchParams.get('from') || '')
  const [toDate, setToDate] = useState(searchParams.get('to') || '')
  // Dates apply on Search; customer and status filter live (server-side now).
  const [range, setRange] = useState({ from: searchParams.get('from') || '', to: searchParams.get('to') || '' })
  const [customerSearch, setCustomerSearch] = useState(searchParams.get('customer') || '')
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || '')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [downloading, setDownloading] = useState(false)
  const toast = useActionToast()
  const [showSuggestions, setShowSuggestions] = useState(false)
  const customerRef = useRef<HTMLDivElement>(null)

  function syncUrl(patch: Record<string, string>) {
    const p = new URLSearchParams(window.location.search)
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v)
      else p.delete(k)
    }
    router.replace(`${ap('/admin/packing-slips')}?${p.toString()}`, { scroll: false })
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (customerRef.current && !customerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])


  const PAGE_SIZE = 25
  const list = useInfiniteList<Order>({
    key: `${range.from}|${range.to}|${customerSearch.trim()}|${statusFilter}`,
    pageSize: PAGE_SIZE,
    getKey: o => o.id,
    fetchPage: async (page, signal) => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
      if (range.from) params.set('from', range.from)
      if (range.to) params.set('to', range.to)
      if (customerSearch.trim()) params.set('customer', customerSearch.trim())
      if (statusFilter) params.set('status', statusFilter)
      const data = await fetchJson(`/api/admin/packing-slips/list?${params}`, signal)
      return { rows: data.orders || [], total: data.total ?? null }
    },
  })
  const orders = list.rows

  const customerSuggestions = useMemo(() => {
    if (!customerSearch.trim()) return []
    const q = customerSearch.toLowerCase()
    const seen = new Set<string>()
    return orders
      .map(o => o.customer_name)
      .filter(name => {
        if (!name) return false
        const key = name.toLowerCase()
        if (!key.includes(q) || seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, 8)
  }, [orders, customerSearch])
  const filtered = orders
  const paged = orders
  const filtering = list.loading
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


  function applyDateFilter() {
    setRange({ from: fromDate, to: toDate })
    setSelectedIds(new Set())
  }

  function clearAll() {
    setFromDate('')
    setToDate('')
    setRange({ from: '', to: '' })
    setCustomerSearch('')
    setStatusFilter('')
    syncUrl({ from: '', to: '', customer: '', status: '' })
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

  const hasActiveFilters = fromDate || toDate || customerSearch || statusFilter

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-5">
        <PageHeader title="Packing Slips" description="Download packing slips to attach to parcels" />
      </div>

      {tabs}

      <div className="bg-surface-elevated border border-border-default rounded-xl p-4 space-y-3 mb-6">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex-1 min-w-[200px]" ref={customerRef}>
            <div className="relative">
              <input
                type="text"
                placeholder="Search by customer name…"
                value={customerSearch}
                onChange={e => {
                  setCustomerSearch(e.target.value)
                  setShowSuggestions(true)
                  syncUrl({ customer: e.target.value })
                }}
                onFocus={() => setShowSuggestions(true)}
                className="field-md w-full border border-border-secondary bg-surface pr-9 text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground-muted pointer-events-none">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"
                  />
                </svg>
              </span>
              {showSuggestions && customerSuggestions.length > 0 && (
                <ul className="absolute z-50 left-0 right-0 top-full mt-1 bg-surface-elevated border border-border-default rounded-lg shadow-lg overflow-hidden max-h-60 overflow-y-auto">
                  {customerSuggestions.map(name => (
                    <li key={name}>
                      <button
                        type="button"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => {
                          setCustomerSearch(name)
                          setShowSuggestions(false)
                          syncUrl({ customer: name })
                        }}
                        className="w-full text-left px-4 py-2.5 text-sm text-foreground-secondary hover:bg-surface-secondary transition-colors"
                      >
                        {name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <button
            onClick={applyDateFilter}
            disabled={filtering}
            className="px-4 h-control-sm bg-secondary-500 hover:bg-secondary-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
          >
            {filtering ? 'Loading…' : 'Search'}
          </button>
          {hasActiveFilters && (
            <button
              onClick={clearAll}
              className="px-4 h-control-sm border border-border-default text-sm text-foreground-secondary rounded-lg hover:bg-surface-secondary transition-colors"
            >
              Clear
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <AdminSelect
            sm
            value={statusFilter}
            options={STATUS_OPTIONS}
            onChange={v => {
              setStatusFilter(v)
              syncUrl({ status: v })
            }}
            placeholder="All Statuses"
          />
          <div className="flex items-center gap-2">
            <DatePicker
              className="w-36"
              value={fromDate}
              onChange={v => {
                setFromDate(v)
                syncUrl({ from: v })
              }}
            />
            <span className="text-foreground-secondary text-xs">to</span>
            <DatePicker
              className="w-36"
              value={toDate}
              onChange={v => {
                setToDate(v)
                syncUrl({ to: v })
              }}
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 bg-red-500/5 border border-red-500/40 text-red-600 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="bg-surface-elevated rounded-xl border border-border-default">
        <div className="px-6 py-4 border-b border-border-default flex items-center justify-between">
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

        {filtered.length === 0 ? (
          <div className="px-6 py-12 text-center text-foreground-muted text-sm">
            {list.loading ? 'Loading…' : customerSearch || statusFilter ? 'No orders match the current filters.' : 'No orders found for the selected date range.'}
          </div>
        ) : (
          <>
            <div className="md:hidden p-4 pt-0 space-y-3">
              <PackingSlipsMobileList
                orders={paged}
                statusColors={STATUS_COLORS}
                statusLabel={statusLabel}
                selectedIds={selectedIds}
                onToggleOne={toggleOne}
              />
            </div>
            <div className="hidden md:block overflow-x-auto">
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
                    <th className="px-4 py-3 text-left font-semibold text-foreground-secondary">
                      <div className="flex items-center gap-1">
                        Customer
                        {customerSearch && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-secondary text-foreground-secondary">
                            {customerSearch}
                            <button onClick={() => setCustomerSearch('')} className="ml-1 hover:text-red-500">
                              ×
                            </button>
                          </span>
                        )}
                      </div>
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-foreground-secondary">Date</th>
                    <th className="px-4 py-3 text-left font-semibold text-foreground-secondary">
                      <div className="flex items-center gap-1">
                        Status
                        {statusFilter && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-secondary text-foreground-secondary">
                            {statusLabel(statusFilter)}
                            <button onClick={() => setStatusFilter('')} className="ml-1 hover:text-red-500">
                              ×
                            </button>
                          </span>
                        )}
                      </div>
                    </th>
                    <th className="px-4 py-3 text-right font-semibold text-foreground-secondary">Total</th>
                    <th className="px-4 py-3 text-center font-semibold text-foreground-secondary">Slip</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-default">
                  {paged.map(order => (
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
