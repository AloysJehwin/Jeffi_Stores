'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import AdminSelect from '@/components/admin/AdminSelect'
import DatePicker from '@/components/ui/DatePicker'
import { ap } from '@/lib/admin-path'


interface Order {
  id: string
  order_number: string
  customer_name: string
  created_at: string
  status: string
  total_amount: number
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  confirmed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  processing: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  shipped: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  delivered: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
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

export default function PackingSlipsClient({ initialOrders }: { initialOrders: Order[] }) {
  const searchParams = useSearchParams()
  const router = useRouter()

  const [orders, setOrders] = useState<Order[]>(initialOrders)
  const [fromDate, setFromDate] = useState(searchParams.get('from') || '')
  const [toDate, setToDate] = useState(searchParams.get('to') || '')
  const [customerSearch, setCustomerSearch] = useState(searchParams.get('customer') || '')
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || '')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [filtering, setFiltering] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const customerRef = useRef<HTMLDivElement>(null)

  function syncUrl(patch: Record<string, string>) {
    const p = new URLSearchParams(window.location.search)
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v); else p.delete(k)
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

  const filtered = useMemo(() => {
    return orders.filter(o => {
      if (customerSearch && !o.customer_name?.toLowerCase().includes(customerSearch.toLowerCase())) return false
      if (statusFilter && o.status !== statusFilter) return false
      return true
    })
  }, [orders, customerSearch, statusFilter])

  const allSelected = filtered.length > 0 && filtered.every(o => selectedIds.has(o.id))

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev)
        filtered.forEach(o => next.delete(o.id))
        return next
      })
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev)
        filtered.forEach(o => next.add(o.id))
        return next
      })
    }
  }

  function toggleOne(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedVisible = filtered.filter(o => selectedIds.has(o.id)).length

  async function applyDateFilter() {
    setFiltering(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (fromDate) params.set('from', fromDate)
      if (toDate) params.set('to', toDate)
      const res = await fetch(`/api/admin/packing-slips/list?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load orders')
      setOrders(data.orders)
      setSelectedIds(new Set())
    } catch (e: any) {
      setError(e.message)
    } finally {
      setFiltering(false)
    }
  }

  function clearAll() {
    setFromDate('')
    setToDate('')
    setCustomerSearch('')
    setStatusFilter('')
    syncUrl({ from: '', to: '', customer: '', status: '' })
  }

  async function downloadBulk() {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    setDownloading(true)
    setError('')
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
      setError(e.message)
    } finally {
      setDownloading(false)
    }
  }

  const hasActiveFilters = fromDate || toDate || customerSearch || statusFilter

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Packing Slips</h1>
        <p className="text-sm text-foreground-muted mt-1">Download packing slips to attach to parcels</p>
      </div>

      <div className="bg-surface-elevated border border-border-default rounded-xl p-4 space-y-3 mb-6">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex-1 min-w-[200px]" ref={customerRef}>
            <div className="relative">
              <input
                type="text"
                placeholder="Search by customer name…"
                value={customerSearch}
                onChange={e => { setCustomerSearch(e.target.value); setShowSuggestions(true); syncUrl({ customer: e.target.value }) }}
                onFocus={() => setShowSuggestions(true)}
                className="w-full px-2 py-1.5 pr-9 rounded border border-border-default bg-surface-secondary text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-secondary-500 placeholder:text-foreground-muted"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground-muted pointer-events-none">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                </svg>
              </span>
              {showSuggestions && customerSuggestions.length > 0 && (
                <ul className="absolute z-50 left-0 right-0 top-full mt-1 bg-surface-elevated border border-border-default rounded-lg shadow-lg overflow-hidden max-h-60 overflow-y-auto">
                  {customerSuggestions.map(name => (
                    <li key={name}>
                      <button
                        type="button"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => { setCustomerSearch(name); setShowSuggestions(false); syncUrl({ customer: name }) }}
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
            className="px-4 py-1.5 bg-secondary-500 hover:bg-secondary-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
          >
            {filtering ? 'Loading…' : 'Search'}
          </button>
          {hasActiveFilters && (
            <button
              onClick={clearAll}
              className="px-4 py-1.5 border border-border-default text-sm text-foreground-secondary rounded-lg hover:bg-surface-secondary transition-colors"
            >
              Clear
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <AdminSelect
            value={statusFilter}
            options={STATUS_OPTIONS}
            onChange={v => { setStatusFilter(v); syncUrl({ status: v }) }}
            placeholder="All Statuses"
          />
          <div className="flex items-center gap-2">
            <DatePicker className="w-36" value={fromDate} onChange={v => { setFromDate(v); syncUrl({ from: v }) }} />
            <span className="text-foreground-secondary text-xs">to</span>
            <DatePicker className="w-36" value={toDate} onChange={v => { setToDate(v); syncUrl({ to: v }) }} />
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="bg-surface-elevated rounded-lg border border-border-default shadow-sm">
        <div className="px-6 py-4 border-b border-border-default flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">
            Orders
            <span className="ml-2 text-sm font-normal text-foreground-muted">
              {filtered.length !== orders.length ? `${filtered.length} of ${orders.length}` : orders.length}
            </span>
          </h2>
          {selectedIds.size > 0 && (
            <button
              onClick={downloadBulk}
              disabled={downloading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-secondary-500 hover:bg-secondary-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              {downloading ? 'Generating…' : `Download Selected (${selectedIds.size})`}
            </button>
          )}
        </div>

        {filtered.length === 0 ? (
          <div className="px-6 py-12 text-center text-foreground-muted text-sm">
            {orders.length === 0 ? 'No orders found for the selected date range.' : 'No orders match the current filters.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-default bg-surface">
                  <th className="px-4 py-3 text-left w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="rounded border-border-default"
                    />
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-foreground-secondary">Order #</th>
                  <th className="px-4 py-3 text-left font-semibold text-foreground-secondary">
                    <div className="flex items-center gap-1">
                      Customer
                      {customerSearch && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-secondary-100 dark:bg-secondary-900/40 text-secondary-700 dark:text-secondary-300">
                          {customerSearch}
                          <button onClick={() => setCustomerSearch('')} className="ml-1 hover:text-red-500">×</button>
                        </span>
                      )}
                    </div>
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-foreground-secondary">Date</th>
                  <th className="px-4 py-3 text-left font-semibold text-foreground-secondary">
                    <div className="flex items-center gap-1">
                      Status
                      {statusFilter && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-secondary-100 dark:bg-secondary-900/40 text-secondary-700 dark:text-secondary-300">
                          {statusLabel(statusFilter)}
                          <button onClick={() => setStatusFilter('')} className="ml-1 hover:text-red-500">×</button>
                        </span>
                      )}
                    </div>
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-foreground-secondary">Total</th>
                  <th className="px-4 py-3 text-center font-semibold text-foreground-secondary">Slip</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {filtered.map(order => (
                  <tr key={order.id} className="hover:bg-surface transition-colors">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(order.id)}
                        onChange={() => toggleOne(order.id)}
                        className="rounded border-border-default"
                      />
                    </td>
                    <td className="px-4 py-3 font-mono text-foreground font-medium">
                      #{order.order_number}
                    </td>
                    <td className="px-4 py-3 text-foreground">{order.customer_name || '—'}</td>
                    <td className="px-4 py-3 text-foreground-secondary">
                      {new Date(order.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[order.status] || 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}>
                        {statusLabel(order.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-foreground font-medium">
                      ₹{Number(order.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <a
                        href={`/api/admin/packing-slips/${order.id}`}
                        download
                        title="Download Packing Slip"
                        className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-secondary-50 dark:bg-secondary-900/30 text-secondary-600 dark:text-secondary-400 hover:bg-secondary-100 dark:hover:bg-secondary-800/50 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
