'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type EligibleOrder = {
  id: string
  order_number: string
  awb_number: string
  status: string
  created_at: string
  customer_name: string
  city: string
  state: string
  postal_code: string
}

type PickupRequest = {
  id: string
  pickup_id: string | null
  pickup_date: string
  awb_count: number
  awbs: string[]
  raw_response: Record<string, unknown> | null
  pickup_status: 'pending' | 'picked_up' | 'failed'
  created_at: string
}

function todayIST(): string {
  const now = new Date()
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000))
  return ist.toISOString().slice(0, 10)
}

const STATUS_OPTIONS: { value: PickupRequest['pickup_status']; label: string }[] = [
  { value: 'pending',   label: 'Pending' },
  { value: 'picked_up', label: 'Picked Up' },
  { value: 'failed',    label: 'Failed' },
]

const STATUS_STYLES: Record<PickupRequest['pickup_status'], string> = {
  pending:   'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300',
  picked_up: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300',
  failed:    'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300',
}

export default function DelhiveryPickupPage() {
  const [orders, setOrders] = useState<EligibleOrder[]>([])
  const [pickupHistory, setPickupHistory] = useState<PickupRequest[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pickupDate, setPickupDate] = useState(todayIST())
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [result, setResult] = useState<{ success: boolean; message: string; details?: string } | null>(null)

  const loadData = () => {
    setLoading(true)
    fetch('/api/admin/delhivery/pickup-request')
      .then(r => r.json())
      .then(d => {
        setOrders(d.orders || [])
        setPickupHistory(d.pickupHistory || [])
        setSelected(new Set((d.orders || []).map((o: EligibleOrder) => o.id)))
      })
      .catch(() => setOrders([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadData() }, [])

  const toggleAll = () => {
    if (selected.size === orders.length) setSelected(new Set())
    else setSelected(new Set(orders.map(o => o.id)))
  }

  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  const handleSubmit = async () => {
    if (selected.size === 0) return
    setSubmitting(true)
    setResult(null)
    try {
      const res = await fetch('/api/admin/delhivery/pickup-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds: Array.from(selected), pickupDate }),
      })
      const data = await res.json()
      if (!res.ok) {
        setResult({ success: false, message: data.error || 'Failed', details: data.details })
      } else {
        setResult({
          success: true,
          message: `Pickup request sent for ${data.orderCount} order${data.orderCount !== 1 ? 's' : ''} on ${data.pickupDate}.`,
        })
        loadData()
      }
    } catch (err: any) {
      setResult({ success: false, message: err.message || 'Request failed' })
    } finally {
      setSubmitting(false)
    }
  }

  const handleStatusChange = async (req: PickupRequest, newStatus: PickupRequest['pickup_status']) => {
    setUpdatingId(req.id)
    try {
      const res = await fetch('/api/admin/delhivery/pickup-request', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: req.id, pickup_status: newStatus }),
      })
      if (res.ok) {
        setPickupHistory(prev => prev.map(r => r.id === req.id ? { ...r, pickup_status: newStatus } : r))
        if (newStatus === 'failed') {
          loadData()
        }
      }
    } finally {
      setUpdatingId(null)
    }
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <Link href="/admin/orders" className="text-accent-500 hover:text-accent-600 text-sm mb-2 inline-block">
          ← Back to Orders
        </Link>
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Delhivery Pickup Request</h1>
        <p className="text-foreground-secondary mt-1">
          Orders with an AWB not yet included in a pickup request. Pickup slot: 14:00–18:00.
        </p>
      </div>

      {result && (
        <div className={`mb-6 px-4 py-3 rounded-lg border text-sm ${
          result.success
            ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-300'
            : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300'
        }`}>
          <p className="font-medium">{result.message}</p>
          {result.details && <p className="mt-1 opacity-80">{result.details}</p>}
        </div>
      )}

      <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default mb-6">
        <div className="px-6 py-4 border-b border-border-default flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-foreground">Eligible Orders</h2>
            <span className="text-sm text-foreground-secondary">{orders.length} found</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-foreground-secondary">Pickup date</label>
            <input
              type="date"
              value={pickupDate}
              min={todayIST()}
              onChange={e => setPickupDate(e.target.value)}
              className="text-sm border border-border-default rounded-lg px-3 py-1.5 bg-surface text-foreground"
            />
          </div>
        </div>

        {loading ? (
          <div className="p-8 flex justify-center">
            <div className="animate-spin w-8 h-8 border-4 border-accent-500 border-t-transparent rounded-full" />
          </div>
        ) : orders.length === 0 ? (
          <div className="p-8 text-center text-foreground-muted">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            <p>No eligible orders. All orders with AWBs are already in a pending pickup request.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-default bg-surface-secondary">
                    <th className="px-4 py-3 text-left">
                      <input type="checkbox" checked={selected.size === orders.length} onChange={toggleAll}
                        className="w-4 h-4 rounded border-border-default accent-accent-500" />
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-foreground-secondary">Order</th>
                    <th className="px-4 py-3 text-left font-medium text-foreground-secondary">AWB</th>
                    <th className="px-4 py-3 text-left font-medium text-foreground-secondary">Customer</th>
                    <th className="px-4 py-3 text-left font-medium text-foreground-secondary">Destination</th>
                    <th className="px-4 py-3 text-left font-medium text-foreground-secondary">Placed</th>
                    <th className="px-4 py-3 text-left font-medium text-foreground-secondary">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map(order => (
                    <tr key={order.id} className="border-b border-border-default last:border-0 hover:bg-surface-secondary/50">
                      <td className="px-4 py-3">
                        <input type="checkbox" checked={selected.has(order.id)} onChange={() => toggle(order.id)}
                          className="w-4 h-4 rounded border-border-default accent-accent-500" />
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/admin/orders/${order.id}`} className="font-mono text-accent-500 hover:underline">
                          #{order.order_number || order.id.slice(0, 8)}
                        </Link>
                      </td>
                      <td className="px-4 py-3 font-mono text-foreground">{order.awb_number}</td>
                      <td className="px-4 py-3 text-foreground">{order.customer_name}</td>
                      <td className="px-4 py-3 text-foreground-secondary">
                        {[order.city, order.state, order.postal_code].filter(Boolean).join(', ')}
                      </td>
                      <td className="px-4 py-3 text-foreground-secondary">
                        {new Date(order.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 capitalize">
                          {order.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="px-6 py-4 border-t border-border-default flex items-center justify-between gap-3">
              <p className="text-sm text-foreground-secondary">{selected.size} of {orders.length} selected</p>
              <button onClick={handleSubmit} disabled={submitting || selected.size === 0}
                className="px-5 py-2.5 text-sm font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white transition-colors flex items-center gap-2">
                {submitting ? (
                  <>
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Sending…
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    Request Pickup — {selected.size} order{selected.size !== 1 ? 's' : ''}
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>

      {pickupHistory.length > 0 && (
        <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default">
          <div className="px-6 py-4 border-b border-border-default">
            <h2 className="text-lg font-semibold text-foreground">Pickup Request History</h2>
            <p className="text-sm text-foreground-secondary mt-0.5">Update each request once you confirm pickup outcome with Delhivery</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-default bg-surface-secondary">
                  <th className="px-4 py-3 text-left font-medium text-foreground-secondary">Pickup Date</th>
                  <th className="px-4 py-3 text-left font-medium text-foreground-secondary">Delhivery ID</th>
                  <th className="px-4 py-3 text-left font-medium text-foreground-secondary">AWBs</th>
                  <th className="px-4 py-3 text-left font-medium text-foreground-secondary">Requested At</th>
                  <th className="px-4 py-3 text-left font-medium text-foreground-secondary">Status</th>
                </tr>
              </thead>
              <tbody>
                {pickupHistory.map(req => (
                  <tr key={req.id} className="border-b border-border-default last:border-0 hover:bg-surface-secondary/50">
                    <td className="px-4 py-3 text-foreground font-medium">
                      {new Date(req.pickup_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-3 font-mono text-foreground-secondary">
                      {req.pickup_id ?? <span className="italic text-foreground-muted">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {req.awbs.map(awb => (
                          <span key={awb} className="px-1.5 py-0.5 rounded bg-surface-secondary font-mono text-xs text-foreground">{awb}</span>
                        ))}
                        <span className="text-xs text-foreground-secondary self-center">({req.awb_count})</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-foreground-secondary">
                      {new Date(req.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLES[req.pickup_status]}`}>
                          {req.pickup_status.replace('_', ' ')}
                        </span>
                        {req.pickup_status !== 'picked_up' && (
                          <select
                            value={req.pickup_status}
                            disabled={updatingId === req.id}
                            onChange={e => handleStatusChange(req, e.target.value as PickupRequest['pickup_status'])}
                            className="text-xs border border-border-default rounded px-2 py-1 bg-surface text-foreground disabled:opacity-50"
                          >
                            {STATUS_OPTIONS.map(opt => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        )}
                        {updatingId === req.id && (
                          <svg className="animate-spin w-3.5 h-3.5 text-foreground-secondary" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                        )}
                      </div>
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
