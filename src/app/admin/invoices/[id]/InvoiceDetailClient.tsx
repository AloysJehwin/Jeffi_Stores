'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Check, Pencil, QrCode } from 'lucide-react'
import CopySku from '@/components/ui/CopySku'
import { ap } from '@/lib/admin-path'
import { useToast } from '@/contexts/ToastContext'
import { useStoreConfig } from '@/contexts/StoreConfigContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'

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
  const [qrLoading, setQrLoading] = useState(false)
  const { showToast } = useToast()
  const storeName = useStoreConfig().identity.name
  const [qrImageUrl, setQrImageUrl] = useState<string | null>(null)
  const [qrModalOpen, setQrModalOpen] = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  const [finalizeError, setFinalizeError] = useState<string | null>(null)
  const [amendDraft, setAmendDraft] = useState<{ id: string; order_number: string } | null | undefined>(undefined)
  const [amending, setAmending] = useState(false)
  const [amendError, setAmendError] = useState<string | null>(null)
  const qrModalRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const canWrite = useCanWrite('invoices')

  function loadData() {
    return fetch(`/api/admin/invoices/${id}/detail`)
      .then(r => r.json())
      .then(j => {
        if (j.redirect) { router.replace(j.redirect); return }
        setData(j)
        setQrImageUrl(j.order?.razorpay_qr_image_url || null)
        setLoading(false)
        // Check for amendment draft only for finalized invoices
        if (j.order?.invoice_number && j.order?.status !== 'draft') {
          fetch(`/api/admin/invoices/${id}/amendment-draft`, { credentials: 'include' })
            .then(r => r.ok ? r.json() : null)
            .then(d => {
              setAmendDraft(d?.draft ?? null)
            })
            .catch(() => { setAmendDraft(null) })
        } else {
          setAmendDraft(null)
        }
        return j
      })
      .catch(() => { setLoading(false) })
  }

  useEffect(() => {
    loadData()
  }, [id, router])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setQrModalOpen(false) }
    function onClickOutside(e: MouseEvent) {
      if (qrModalRef.current && !qrModalRef.current.contains(e.target as Node)) setQrModalOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClickOutside)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClickOutside) }
  }, [])

  // Poll every 4s while QR is shown and payment is unpaid
  useEffect(() => {
    const order = data?.order
    if (!order || order.payment_mode !== 'upi_qr' || order.payment_status === 'paid') return
    const interval = setInterval(async () => {
      const j = await fetch(`/api/admin/invoices/${id}/detail`).then(r => r.json()).catch(() => null)
      if (!j?.order) return
      if (j.order.payment_status === 'paid') {
        setData(j)
        clearInterval(interval)
      }
    }, 4000)
    return () => clearInterval(interval)
  }, [id, data?.order?.payment_status, data?.order?.payment_mode])

  async function generateQr() {
    if (!data?.order) return
    setQrLoading(true)
    try {
      const res = await fetch('/api/admin/razorpay/qr', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: data.order.id,
          amountPaise: Math.round(parseFloat(data.order.total_amount) * 100),
          description: `${storeName} Invoice ${data.order.invoice_number}`,
        }),
      })
      const json = await res.json()
      if (res.ok && json.qrImageUrl) {
        setQrImageUrl(json.qrImageUrl)
        setQrModalOpen(true)
      }
      else showToast(json.error || 'Failed to generate QR', 'error')
    } finally {
      setQrLoading(false)
    }
  }

  async function finalizeInvoice() {
    setFinalizing(true)
    setFinalizeError(null)
    try {
      const res = await fetch(`/api/admin/invoices/drafts/${id}/finalize`, {
        method: 'POST',
        credentials: 'include',
      })
      const json = await res.json()
      if (!res.ok) { setFinalizeError(json.error || 'Failed to finalize'); return }
      await loadData()
    } catch {
      setFinalizeError('Failed to finalize invoice')
    } finally {
      setFinalizing(false)
    }
  }

  async function createAmendmentDraft() {
    setAmending(true)
    setAmendError(null)
    try {
      const res = await fetch(`/api/admin/invoices/${id}/amendment-draft`, {
        method: 'POST',
        credentials: 'include',
      })
      const json = await res.json()
      if (!res.ok) { setAmendError(json.error || 'Failed to create amendment draft'); return }
      router.push(ap(`/admin/invoices/${json.draftId}`))
    } catch {
      setAmendError('Failed to create amendment draft')
    } finally {
      setAmending(false)
    }
  }

  if (!loading && !data?.order) {
    return (
      <div className="p-6">
        <p className="text-foreground-secondary">Invoice not found.</p>
        <Link href={ap('/admin/invoices')} className="text-accent-500 hover:underline text-sm mt-2 inline-block">← Back to Invoices</Link>
      </div>
    )
  }

  if (loading || !data?.order) {
    return (
      <div className="p-4 sm:p-6 space-y-6 animate-fade-in">
        {/* Back link */}
        <div className="h-4 w-32 bg-surface-secondary rounded animate-pulse" />
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="h-8 w-44 bg-surface-secondary rounded animate-pulse" />
            <div className="h-5 w-14 bg-surface-secondary rounded-full animate-pulse" />
            <div className="h-5 w-16 bg-surface-secondary rounded-full animate-pulse" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-8 w-28 bg-surface-secondary rounded-lg animate-pulse" />
            <div className="h-8 w-24 bg-surface-secondary rounded-lg animate-pulse" />
          </div>
        </div>
        {/* Info cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-surface-elevated rounded-xl border border-border-default p-4 space-y-3" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="h-3 w-28 bg-surface-secondary rounded animate-pulse" />
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, j) => (
                  <div key={j} className="flex justify-between gap-4 animate-pulse" style={{ animationDelay: `${j * 40}ms` }}>
                    <div className="h-3.5 w-16 bg-surface-secondary rounded shrink-0" />
                    <div className="h-3.5 bg-surface-secondary rounded flex-1" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {/* Line items table */}
        <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
          <div className="px-4 py-3 border-b border-border-default">
            <div className="h-4 w-20 bg-surface-secondary rounded animate-pulse" />
          </div>
          <div className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex gap-4 animate-pulse" style={{ animationDelay: `${i * 50}ms` }}>
                <div className="h-4 bg-surface-secondary rounded flex-1" />
                <div className="h-4 w-12 bg-surface-secondary rounded shrink-0" />
                <div className="h-4 w-10 bg-surface-secondary rounded shrink-0" />
                <div className="h-4 w-14 bg-surface-secondary rounded shrink-0" />
                <div className="h-4 w-14 bg-surface-secondary rounded shrink-0" />
                <div className="h-4 w-20 bg-surface-secondary rounded shrink-0" />
              </div>
            ))}
          </div>
          <div className="border-t border-border-default px-4 py-3">
            <div className="ml-auto max-w-xs space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex justify-between gap-8 animate-pulse">
                  <div className="h-3.5 w-20 bg-surface-secondary rounded" />
                  <div className="h-3.5 w-20 bg-surface-secondary rounded" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  const o = data.order
  const items: any[] = data.items || []
  const hasItemDiscount = items.some((it: any) => parseFloat(it.discount_amount || '0') > 0)
  const isVoided = o.status === 'cancelled' || o.status === 'returned'
  const showQrSection = o.payment_mode === 'upi_qr' && o.payment_status !== 'paid'

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* QR Modal */}
      {qrModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div ref={qrModalRef} className="bg-surface-elevated rounded-2xl shadow-2xl border border-border-default p-6 flex flex-col items-center gap-4 max-w-xs w-full">
            <div className="flex items-center justify-between w-full">
              <p className="text-sm font-semibold text-foreground">UPI QR — {formatINR(parseFloat(o.total_amount))}</p>
              <button onClick={() => setQrModalOpen(false)} className="text-foreground-muted hover:text-foreground transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {qrLoading ? (
              <div className="w-52 h-52 flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : qrImageUrl ? (
              <img src={qrImageUrl} alt="UPI QR Code" className="w-52 h-52 object-contain rounded-lg" />
            ) : (
              <p className="text-sm text-foreground-secondary">No QR available.</p>
            )}
            <p className="text-xs text-foreground-secondary text-center">Scan with any UPI app to pay</p>
            <button
              onClick={generateQr}
              disabled={qrLoading}
              className="text-xs text-foreground-secondary hover:text-foreground underline underline-offset-2 transition-colors disabled:opacity-50"
            >
              {qrLoading ? 'Regenerating…' : 'Regenerate QR'}
            </button>
          </div>
        </div>
      )}
      {/* Breadcrumb (matches order detail pattern) */}
      <a
        href={ap('/admin/invoices')}
        className="text-accent-500 hover:text-accent-600 text-sm mb-2 inline-block"
      >
        ← Back to Invoices
      </a>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground font-mono">Invoice #{o.invoice_number}</h1>
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
          {o.status === 'draft' && o.source === 'offline' && (
            <a
              href={ap(`/admin/invoices?view=edit&edit=${o.id}`)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-default text-sm font-medium text-foreground hover:bg-surface-secondary transition-colors"
            >
              <Pencil className="w-4 h-4" />
              Edit
            </a>
          )}
          {o.status === 'draft' && canWrite && (
            <button
              onClick={finalizeInvoice}
              disabled={finalizing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-500 text-white text-sm font-medium hover:bg-accent-600 transition-colors disabled:opacity-50"
            >
              {finalizing ? 'Finalizing…' : 'Finalize Invoice'}
            </button>
          )}
          {showQrSection && canWrite && (
            <button
              onClick={() => qrImageUrl ? setQrModalOpen(true) : generateQr()}
              disabled={qrLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-default text-sm font-medium text-foreground hover:bg-surface-secondary transition-colors disabled:opacity-50"
            >
              <QrCode className="w-4 h-4" />
              {qrLoading ? 'Generating…' : 'QR'}
            </button>
          )}
          {o.invoice_number && o.status !== 'draft' && o.source !== 'online' && amendDraft === null && canWrite && (
            <button
              onClick={createAmendmentDraft}
              disabled={amending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-default text-sm font-medium text-foreground hover:bg-surface-secondary transition-colors disabled:opacity-50"
            >
              {amending ? 'Creating…' : 'Amend Invoice'}
            </button>
          )}
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
            href={ap(`/admin/orders/${o.id}`)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-default text-sm font-medium text-foreground hover:bg-surface-secondary transition-colors"
          >
            View Order
          </Link>
        </div>
      </div>

      {/* Info Cards */}
      {finalizeError && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
          {finalizeError}
        </div>
      )}
      {amendError && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
          {amendError}
        </div>
      )}
      {amendDraft && (
        <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 text-sm text-blue-800 dark:text-blue-300">
          <span>An amendment draft is pending for this invoice.</span>
          <a
            href={ap(`/admin/invoices/${amendDraft.id}`)}
            className="shrink-0 font-semibold underline underline-offset-2 hover:text-blue-900 dark:hover:text-blue-100 transition-colors"
          >
            View draft ({amendDraft.order_number})
          </a>
        </div>
      )}
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
                {hasItemDiscount && <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Disc.</th>}
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
                    {item.product_sku && <div className="text-xs text-foreground-muted font-mono inline-flex items-center gap-1">{item.product_sku}<CopySku sku={item.product_sku} /></div>}
                  </td>
                  <td className="px-4 py-3 text-center text-xs text-foreground-secondary font-mono">{item.hsn_code || '—'}</td>
                  <td className="px-4 py-3 text-center text-xs text-foreground-secondary">{item.gst_rate}%</td>
                  <td className="px-4 py-3 text-center text-foreground">
                    {(() => {
                      const orderedQty = Number(item.quantity)
                      const isCount = item.sell_unit_dimension === 'count'
                      const factor = item.sell_unit_factor ? Number(item.sell_unit_factor) : 1
                      const unitLabel = (item.buy_unit && item.buy_unit !== 'unit') ? item.buy_unit : null
                      if (isCount && unitLabel && factor > 1) {
                        return `${orderedQty} ${unitLabel} (${orderedQty * factor} pcs)`
                      }
                      if (unitLabel && !isCount) {
                        return `${orderedQty} ${unitLabel}`
                      }
                      return orderedQty
                    })()}
                  </td>
                  <td className="px-4 py-3 text-right text-foreground">{formatINR(parseFloat(item.unit_price))}</td>
                  {hasItemDiscount && (
                    <td className="px-4 py-3 text-right text-green-600 dark:text-green-400 text-xs">
                      {parseFloat(item.discount_amount || '0') > 0 ? `−${formatINR(parseFloat(item.discount_amount))}` : '—'}
                    </td>
                  )}
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
                <span className="text-foreground-secondary">Coupon Discount</span>
                <span className="text-green-600 dark:text-green-400">−{formatINR(parseFloat(o.discount_amount))}</span>
              </div>
            )}
            {parseFloat(o.business_discount_amount || '0') > 0 && (
              <div className="flex justify-between gap-8">
                <span className="text-foreground-secondary">Business Discount</span>
                <span className="text-green-600 dark:text-green-400">−{formatINR(parseFloat(o.business_discount_amount))}</span>
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
