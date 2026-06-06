'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Check, ChevronLeft } from 'lucide-react'

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n)
}

function formatDate(s: string) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

const STATUS_COLORS: Record<string, string> = {
  paid: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  unpaid: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  processing: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  shipped: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  delivered: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  returned: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
}

export default function InvoiceDetailClient({ id }: { id: string }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    fetch(`/api/admin/invoices/${id}/detail`)
      .then(r => r.json())
      .then(j => {
        if (j.redirect) { router.replace(j.redirect); return }
        setData(j); setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [id, router])

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[200px]">
        <div className="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!data?.order) {
    return (
      <div className="p-6">
        <p className="text-foreground-secondary">Invoice not found.</p>
        <Link href="/admin/invoices" className="text-accent-500 hover:underline text-sm mt-2 inline-block">← Back to Invoices</Link>
      </div>
    )
  }

  const o = data.order
  const items: any[] = data.items || []
  const isVoided = o.status === 'cancelled' || o.status === 'returned'

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6 text-sm">
        <a href="/admin/invoices" className="flex items-center gap-1.5 text-foreground-muted hover:text-foreground transition-colors">
          <ChevronLeft className="w-4 h-4" />
          Invoices
        </a>
        <span className="text-border-default">/</span>
        <span className="text-foreground font-medium">Invoice #{o.invoice_number}</span>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href="/admin/invoices" className="text-foreground-secondary hover:text-foreground transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-xl font-bold text-foreground font-mono">{o.invoice_number}</h1>
          {isVoided && (
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 uppercase">
              {o.status}
            </span>
          )}
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[o.payment_status] || 'bg-surface-secondary text-foreground-secondary'}`}>
            {o.payment_status}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/api/orders/${o.id}/invoice`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-500 text-white text-sm font-medium hover:bg-accent-600 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Download PDF
          </a>
          <Link
            href={`/admin/orders/${o.id}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-default text-sm font-medium text-foreground hover:bg-surface-secondary transition-colors"
          >
            View Order
          </Link>
        </div>
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Invoice Details */}
        <div className="bg-surface-elevated rounded-xl border border-border-default p-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Invoice Details</p>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-foreground-secondary">Invoice #</span>
              <span className="font-mono font-medium text-foreground">{o.invoice_number}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-foreground-secondary">Order #</span>
              <span className="font-mono text-foreground">{o.order_number}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-foreground-secondary">Date</span>
              <span className="text-foreground">{formatDate(o.invoice_date || o.created_at)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-foreground-secondary">Source</span>
              <span className="capitalize text-foreground">{o.source}</span>
            </div>
            {o.irn && (
              <div className="flex justify-between gap-4">
                <span className="text-foreground-secondary">IRN</span>
                <span className={`text-xs font-medium inline-flex items-center gap-1 ${o.irn_status === 'generated' ? 'text-green-600 dark:text-green-400' : 'text-yellow-600 dark:text-yellow-400'}`}>
                  {o.irn_status === 'generated' ? <><Check className="w-3 h-3" /> Generated</> : 'Stub'}
                </span>
              </div>
            )}
            {o.eway_bill_no && (
              <div className="flex justify-between gap-4">
                <span className="text-foreground-secondary">E-Way Bill</span>
                <span className="font-mono text-xs text-foreground">{o.eway_bill_no}</span>
              </div>
            )}
          </div>
        </div>

        {/* Customer Details */}
        <div className="bg-surface-elevated rounded-xl border border-border-default p-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Customer</p>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-foreground-secondary">Name</span>
              <span className="font-medium text-foreground text-right">{o.customer_name}</span>
            </div>
            {o.customer_phone && (
              <div className="flex justify-between gap-4">
                <span className="text-foreground-secondary">Phone</span>
                <span className="text-foreground">{o.customer_phone}</span>
              </div>
            )}
            {o.customer_email && (
              <div className="flex justify-between gap-4">
                <span className="text-foreground-secondary">Email</span>
                <span className="text-foreground text-right text-xs">{o.customer_email}</span>
              </div>
            )}
            {o.buyer_gstin && (
              <div className="flex justify-between gap-4">
                <span className="text-foreground-secondary">GSTIN</span>
                <span className="font-mono text-xs text-foreground">{o.buyer_gstin}</span>
              </div>
            )}
            {o.address_line1 && (
              <div className="flex justify-between gap-4">
                <span className="text-foreground-secondary shrink-0">Address</span>
                <span className="text-foreground text-right text-xs">
                  {[o.address_line1, o.address_line2, o.city, o.state, o.postal_code].filter(Boolean).join(', ')}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Shipping */}
        {(o.tracking_number || o.shipping_method || o.shipped_at) && (
          <div className="bg-surface-elevated rounded-xl border border-border-default p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Shipping</p>
            <div className="space-y-1.5 text-sm">
              {o.shipping_method && (
                <div className="flex justify-between gap-4">
                  <span className="text-foreground-secondary">Method</span>
                  <span className="text-foreground capitalize">{o.shipping_method}</span>
                </div>
              )}
              {o.tracking_number && (
                <div className="flex justify-between gap-4">
                  <span className="text-foreground-secondary">Tracking</span>
                  <span className="font-mono text-xs text-foreground">{o.tracking_number}</span>
                </div>
              )}
              {o.shipped_at && (
                <div className="flex justify-between gap-4">
                  <span className="text-foreground-secondary">Shipped</span>
                  <span className="text-foreground">{formatDate(o.shipped_at)}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Line Items */}
      <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
        <div className="px-4 py-3 border-b border-border-default">
          <p className="text-sm font-semibold text-foreground">Line Items</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-secondary">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Item</th>
                <th className="px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-foreground-secondary">HSN</th>
                <th className="px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-foreground-secondary">GST%</th>
                <th className="px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Qty</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Unit Price</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Taxable</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Tax</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {items.map((item: any, idx: number) => (
                <tr key={idx} className="hover:bg-surface-secondary/40 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{item.product_name}</div>
                    {item.variant_name && <div className="text-xs text-foreground-secondary">{item.variant_name}</div>}
                    {item.product_sku && <div className="text-xs text-foreground-muted font-mono">{item.product_sku}</div>}
                  </td>
                  <td className="px-4 py-3 text-center text-xs text-foreground-secondary font-mono">{item.hsn_code || '—'}</td>
                  <td className="px-4 py-3 text-center text-xs text-foreground-secondary">{item.gst_rate}%</td>
                  <td className="px-4 py-3 text-center text-foreground">{item.quantity}</td>
                  <td className="px-4 py-3 text-right text-foreground">{formatINR(parseFloat(item.unit_price))}</td>
                  <td className="px-4 py-3 text-right text-foreground-secondary">{formatINR(parseFloat(item.taxable_amount || '0'))}</td>
                  <td className="px-4 py-3 text-right text-foreground-secondary">{formatINR(parseFloat(item.tax_amount || '0'))}</td>
                  <td className="px-4 py-3 text-right font-semibold text-foreground">{formatINR(parseFloat(item.total_price))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="border-t border-border-default px-4 py-3">
          <div className="ml-auto max-w-xs space-y-1.5 text-sm">
            <div className="flex justify-between gap-8">
              <span className="text-foreground-secondary">Subtotal</span>
              <span className="text-foreground">{formatINR(parseFloat(o.subtotal))}</span>
            </div>
            {parseFloat(o.discount_amount || '0') > 0 && (
              <div className="flex justify-between gap-8">
                <span className="text-foreground-secondary">Discount</span>
                <span className="text-green-600 dark:text-green-400">−{formatINR(parseFloat(o.discount_amount))}</span>
              </div>
            )}
            {parseFloat(o.shipping_amount || '0') > 0 && (
              <div className="flex justify-between gap-8">
                <span className="text-foreground-secondary">Shipping</span>
                <span className="text-foreground">{formatINR(parseFloat(o.shipping_amount))}</span>
              </div>
            )}
            {o.is_igst ? (
              <div className="flex justify-between gap-8">
                <span className="text-foreground-secondary">IGST</span>
                <span className="text-foreground">{formatINR(parseFloat(o.igst_amount || '0'))}</span>
              </div>
            ) : (
              <>
                {parseFloat(o.cgst_amount || '0') > 0 && (
                  <div className="flex justify-between gap-8">
                    <span className="text-foreground-secondary">CGST</span>
                    <span className="text-foreground">{formatINR(parseFloat(o.cgst_amount))}</span>
                  </div>
                )}
                {parseFloat(o.sgst_amount || '0') > 0 && (
                  <div className="flex justify-between gap-8">
                    <span className="text-foreground-secondary">SGST</span>
                    <span className="text-foreground">{formatINR(parseFloat(o.sgst_amount))}</span>
                  </div>
                )}
              </>
            )}
            <div className="flex justify-between gap-8 pt-1.5 border-t border-border-default">
              <span className="font-semibold text-foreground">Total</span>
              <span className="font-bold text-foreground text-base">{formatINR(parseFloat(o.total_amount))}</span>
            </div>
          </div>
        </div>
      </div>

      {o.notes && (
        <div className="bg-surface-elevated rounded-xl border border-border-default p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary mb-1.5">Notes</p>
          <p className="text-sm text-foreground">{o.notes}</p>
        </div>
      )}
    </div>
  )
}
