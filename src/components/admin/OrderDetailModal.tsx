'use client'

import { useEffect, useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'

interface Props {
  order: any | null
  onClose: () => void
}

export default function OrderDetailModal({ order, onClose }: Props) {
  const [detail, setDetail] = useState<{ order: any; items: any[] } | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchDetail = useCallback(async (id: string) => {
    setLoading(true)
    setDetail(null)
    try {
      const res = await fetch(`/api/admin/orders/${id}`)
      if (res.ok) setDetail(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (order) fetchDetail(order.id)
  }, [order, fetchDetail])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!order || typeof document === 'undefined') return null

  const o = detail?.order || order
  const items: any[] = detail?.items || []
  const orderNum = o.order_number || o.id.slice(0, 8)
  const customer = o.users
    ? `${o.users.first_name || ''} ${o.users.last_name || ''}`.trim() || o.customer_name || 'Guest'
    : o.customer_name || 'Guest'

  function statusBadgeClass(status: string) {
    if (status === 'delivered') return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
    if (status === 'processing' || status === 'shipped') return 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
    if (status === 'out_for_delivery') return 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300'
    if (status === 'cancelled') return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
    if (status === 'cancel_requested') return 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300'
    return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'
  }

  function paymentBadgeClass(status: string) {
    if (status === 'paid') return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
    if (status === 'pending') return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'
    return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
  }

  function statusLabel(status: string) {
    if (status === 'cancel_requested') return 'Cancel Requested'
    if (status === 'out_for_delivery') return 'Out for Delivery'
    return status.replace(/_/g, ' ')
  }

  const addr = o.shipping_address || o.billing_address

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />

      <div
        className="relative bg-surface-elevated rounded-xl shadow-2xl border border-border-default w-full max-w-3xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {loading && (
          <div className="absolute inset-0 z-10 bg-surface-elevated/80 rounded-xl flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-foreground-muted">Loading details…</p>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-border-default">
          <div className="min-w-0 pr-4">
            <h2 className="text-lg font-bold text-foreground leading-tight font-mono">#{orderNum}</h2>
            <p className="text-xs text-foreground-muted mt-0.5">
              {new Date(o.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
              {' · '}
              {new Date(o.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Link
              href={`/admin/orders/${order.id}`}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent-500 hover:bg-accent-600 text-white transition-colors"
            >
              Full Details
            </Link>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-surface-secondary text-foreground-muted hover:text-foreground transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {/* Status row */}
          <div className="flex flex-wrap gap-2">
            <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${statusBadgeClass(o.status)}`}>
              {statusLabel(o.status)}
            </span>
            <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${paymentBadgeClass(o.payment_status)}`}>
              {o.payment_status}
            </span>
            <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${
              o.source === 'offline'
                ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
            }`}>
              {o.source === 'offline' ? 'Offline' : 'Online'}
            </span>
          </div>

          {/* Customer + address */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-foreground-muted uppercase tracking-wide mb-1.5">Customer</p>
              <p className="text-sm font-semibold text-foreground">{customer}</p>
              {(o.users?.email || o.billing_email) && (
                <p className="text-xs text-foreground-secondary mt-0.5">{o.users?.email || o.billing_email}</p>
              )}
              {(o.users?.phone || o.billing_address?.phone) && (
                <p className="text-xs text-foreground-secondary mt-0.5">{o.users?.phone || o.billing_address?.phone}</p>
              )}
              {o.users?.id && (
                <Link href={`/admin/customers/${o.users.id}`} className="text-xs text-accent-500 hover:underline mt-1 inline-block">
                  View customer →
                </Link>
              )}
            </div>
            {addr && (
              <div>
                <p className="text-xs text-foreground-muted uppercase tracking-wide mb-1.5">Shipping Address</p>
                <p className="text-sm text-foreground leading-relaxed">
                  {[addr.address_line1, addr.address_line2, addr.city, addr.state, addr.pincode].filter(Boolean).join(', ')}
                </p>
              </div>
            )}
          </div>

          {/* Order total */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 rounded-lg bg-surface-secondary">
            <div>
              <p className="text-xs text-foreground-muted">Subtotal</p>
              <p className="text-sm font-semibold text-foreground">₹{Number(o.subtotal || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
            </div>
            {Number(o.discount_amount) > 0 && (
              <div>
                <p className="text-xs text-foreground-muted">Discount</p>
                <p className="text-sm font-semibold text-red-500">−₹{Number(o.discount_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
              </div>
            )}
            {Number(o.shipping_amount) > 0 && (
              <div>
                <p className="text-xs text-foreground-muted">Shipping</p>
                <p className="text-sm font-semibold text-foreground">₹{Number(o.shipping_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-foreground-muted">Total</p>
              <p className="text-sm font-bold text-foreground">₹{Number(o.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
            </div>
          </div>

          {/* Line items */}
          {items.length > 0 && (
            <div>
              <p className="text-xs text-foreground-muted uppercase tracking-wide mb-2">Items ({items.length})</p>
              <div className="rounded-lg border border-border-default overflow-hidden">
                <table className="w-full text-sm divide-y divide-border-default table-fixed">
                  <thead className="bg-surface-secondary">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs text-foreground-muted font-medium w-[45%]">Product</th>
                      <th className="px-3 py-2 text-left text-xs text-foreground-muted font-medium w-[15%]">SKU</th>
                      <th className="px-3 py-2 text-right text-xs text-foreground-muted font-medium w-[12%]">Qty</th>
                      <th className="px-3 py-2 text-right text-xs text-foreground-muted font-medium w-[14%]">Unit</th>
                      <th className="px-3 py-2 text-right text-xs text-foreground-muted font-medium w-[14%]">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default">
                    {items.map((item: any) => (
                      <tr key={item.id} className="hover:bg-surface-secondary">
                        <td className="px-3 py-2 font-medium text-foreground">
                          <p className="truncate" title={item.product_name}>{item.product_name}</p>
                          {item.variant_name && (
                            <p className="text-xs text-foreground-muted truncate">{item.variant_name}</p>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-foreground-muted truncate">{item.product_sku || '—'}</td>
                        <td className="px-3 py-2 text-right text-foreground">{item.quantity}</td>
                        <td className="px-3 py-2 text-right text-foreground">₹{Number(item.unit_price).toLocaleString('en-IN')}</td>
                        <td className="px-3 py-2 text-right font-semibold text-foreground">₹{Number(item.total_price).toLocaleString('en-IN')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Downloads */}
          <div className="flex flex-wrap gap-3 pt-1 border-t border-border-default">
            <a
              href={`/api/admin/packing-slips/${order.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-surface-secondary hover:bg-surface-secondary/70 text-foreground transition-colors border border-border-default"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              Packing Slip
            </a>
            {o.awb_number && (
            <a
              href={`/api/admin/orders/${order.id}/shipping-label?size=4R&inline=1`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-surface-secondary hover:bg-surface-secondary/70 text-foreground transition-colors border border-border-default"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Shipping Label
            </a>
            )}
            <a
              href={`/api/orders/${order.id}/invoice`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-surface-secondary hover:bg-surface-secondary/70 text-foreground transition-colors border border-border-default"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Invoice PDF
            </a>
          </div>
        </div>

        {loading && !detail && <div className="h-64" />}
      </div>
    </div>,
    document.body
  )
}
