'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import CopySku from '@/components/ui/CopySku'
import { ap } from '@/lib/admin-path'
import { useToast } from '@/contexts/ToastContext'
import { useCanWrite, RequireWrite } from '@/contexts/AdminScopesContext'

interface RFQMessage {
  id: string
  sender: 'customer' | 'admin'
  message: string
  counter_items: Array<{ rfq_item_id: string; offered_price: number }> | null
  created_at: string
}

interface RFQItem {
  id: string
  description: string
  quantity: number
  unit: string
  requested_price: number | null
  notes: string | null
  product_name: string | null
  product_sku: string | null
  product_image_url: string | null
  base_price: number | null
  product_mrp: number | null
  product_price_ex_gst: number | null
  product_gst: number | null
  product_category_id: string | null
  variant_name: string | null
  variant_sku: string | null
  variant_price: number | null
  variant_mrp: number | null
  sub_variant_name: string | null
  sub_variant_sku: string | null
  sub_variant_price: number | null
  sub_variant_mrp: number | null
  unit_factor: number
}

interface RFQ {
  id: string
  rfq_number: string
  status: string
  notes: string | null
  admin_note: string | null
  created_at: string
  converted_quotation_id: string | null
  company_name: string
  first_name: string
  last_name: string | null
  email: string
  phone: string | null
  gst_number: string | null
  user_id: string
  quote_number: string | null
  order_id: string | null
  invoice_number: string | null
  invoice_view_token: string | null
  order_status: string | null
  invoice_total: string | null
  invoice_payment_status: string | null
}

const STATUS_STYLES: Record<string, string> = {
  pending:        'bg-yellow-400/20 text-yellow-300',
  reviewed:       'bg-blue-400/20 text-blue-300',
  negotiating:    'bg-purple-400/20 text-purple-300',
  offer_accepted: 'bg-teal-400/20 text-teal-300',
  converted:      'bg-green-400/20 text-green-300',
  rejected:       'bg-red-400/20 text-red-300',
}

const STATUS_LABEL: Record<string, string> = {
  pending:        'Pending Review',
  reviewed:       'Reviewed',
  negotiating:    'Negotiating',
  offer_accepted: 'Offer Accepted',
  converted:      'Converted to Quotation',
  rejected:       'Rejected',
}

function fmt2(n: number) {
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) +
    ', ' + new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function resolveItemMrp(item: RFQItem): number | null {
  const unitFactor = item.unit_factor > 1 ? item.unit_factor : 1
  const rawMrp = item.sub_variant_mrp ?? item.variant_mrp ?? item.product_mrp ?? null
  if (rawMrp == null) return null
  const mrp = Number(rawMrp) * unitFactor
  // Detect Unbrako-style data: MRP column stores ex-GST value (equals price_ex_gst).
  // In that case convert to incl-GST so it's comparable to selling price.
  const rawPriceExGst = item.sub_variant_price ?? item.variant_price ?? item.base_price ?? null
  const sellingInclGst = rawPriceExGst != null ? Number(rawPriceExGst) * unitFactor : null
  const gstRate = item.product_gst != null ? Number(item.product_gst) : 18
  const priceExGstFromVariant = sellingInclGst != null ? sellingInclGst / (1 + gstRate / 100) : null
  if (priceExGstFromVariant != null && Math.abs(Number(rawMrp) - priceExGstFromVariant / unitFactor) < 1) {
    return Number(rawMrp) * (1 + gstRate / 100) * unitFactor
  }
  return mrp
}

function resolveItemSellingPrice(item: RFQItem): number | null {
  const unitFactor = item.unit_factor > 1 ? item.unit_factor : 1
  const raw = item.sub_variant_price ?? item.variant_price ?? item.base_price ?? null
  return raw != null ? Number(raw) * unitFactor : null
}

function resolveItemPrice(item: RFQItem): number | null {
  return resolveItemMrp(item) ?? resolveItemSellingPrice(item)
}

function resolveItemSku(item: RFQItem): string | null {
  return item.sub_variant_sku || item.variant_sku || item.product_sku || null
}

function applyDiscount(price: number, pct: number): number {
  return price * (1 - pct / 100)
}

export default function RFQDetailClient({ id }: { id: string }) {
  const { showToast } = useToast()
  const canWrite = useCanWrite('business_rfqs:write')
  const [rfq, setRfq] = useState<RFQ | null>(null)
  const [items, setItems] = useState<RFQItem[]>([])
  const [discountMap, setDiscountMap] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [converting, setConverting] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [adminNote, setAdminNote] = useState('')
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  // Negotiation thread
  const [messages, setMessages] = useState<RFQMessage[]>([])
  const [replyText, setReplyText] = useState('')
  const [counterInputs, setCounterInputs] = useState<Record<string, string>>({})
  const [showCounterForm, setShowCounterForm] = useState(false)
  const [sendingReply, setSendingReply] = useState(false)
  const threadRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch(`/api/admin/business/rfqs/${id}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        setRfq(d.rfq)
        setItems(d.items || [])
        setDiscountMap(d.discountMap || {})
        setAdminNote(d.rfq?.admin_note || '')
        setLoading(false)
      })
      .catch(() => setLoading(false))

    fetch(`/api/admin/business/rfqs/${id}/messages`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : { messages: [] })
      .then(m => setMessages(m.messages || []))
      .catch(() => {/* messages table may not exist yet */})
  }, [id])

  const handleStatusChange = async (status: 'reviewed' | 'rejected') => {
    setActionLoading(true)
    const res = await fetch(`/api/admin/business/rfqs/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, adminNote }),
    })
    if (res.ok) {
      setRfq(r => r ? { ...r, status, admin_note: adminNote } : r)
      setShowRejectForm(false)
      showToast(status === 'reviewed' ? 'Marked as reviewed' : 'RFQ rejected')
    } else {
      showToast('Action failed', 'error')
    }
    setActionLoading(false)
  }

  const doConvert = async () => {
    setConfirmOpen(false)
    setConverting(true)
    const res = await fetch(`/api/admin/business/rfqs/${id}/convert-to-quotation`, { method: 'POST', credentials: 'include' })
    const data = await res.json()
    if (res.ok) {
      setRfq(r => r ? { ...r, status: 'converted', converted_quotation_id: data.quotationId } : r)
      showToast(`Quotation ${data.quoteNumber} created`)
    } else {
      showToast(data.error || 'Failed to convert', 'error')
    }
    setConverting(false)
  }

  // Auto-scroll thread to bottom
  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight
  }, [messages])

  const handleSendReply = async () => {
    if (!replyText.trim()) return
    setSendingReply(true)

    const counter_items = showCounterForm
      ? items
          .filter(item => counterInputs[item.id]?.trim() !== '')
          .map(item => ({
            rfq_item_id: item.id,
            offered_price: Number(counterInputs[item.id]),
          }))
          .filter(ci => !isNaN(ci.offered_price) && ci.offered_price > 0)
      : null

    const res = await fetch(`/api/admin/business/rfqs/${id}/messages`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: replyText.trim(), counter_items: counter_items?.length ? counter_items : null }),
    })
    const data = await res.json()
    if (res.ok) {
      setMessages(prev => [...prev, data.message])
      setReplyText('')
      setCounterInputs({})
      setShowCounterForm(false)
      setRfq(r => r && r.status !== 'negotiating' ? { ...r, status: 'negotiating' } : r)
      showToast('Reply sent')
    } else {
      showToast(data.error || 'Failed to send reply', 'error')
    }
    setSendingReply(false)
  }

  const latestCustomerCounter = [...messages].reverse().find(m => m.sender === 'customer' && m.counter_items?.length)
  const customerCounterMap: Record<string, number> = {}
  if (latestCustomerCounter?.counter_items) {
    for (const ci of latestCustomerCounter.counter_items) {
      customerCounterMap[ci.rfq_item_id] = ci.offered_price
    }
  }
  // Once an offer is accepted/converted, requested_price holds the agreed price
  // (stamped server-side from the admin's last counter). Don't override it with
  // the customer's prior counter in that case.
  const isFinalState = !!rfq && ['offer_accepted', 'converted'].includes(rfq.status)
  // requested_price is incl-GST (stored as typed in the portal). Customer's
  // latest counter (if any) takes precedence over the original requested_price
  // while the deal is still being negotiated.
  const reqInclGst = (item: RFQItem) => {
    if (!isFinalState && customerCounterMap[item.id] != null) return Number(customerCounterMap[item.id])
    if (item.requested_price == null) return null
    return Number(item.requested_price)
  }
  const totalRequested = items.reduce((sum, i) => {
    const p = reqInclGst(i)
    return sum + (p != null ? p * i.quantity : 0)
  }, 0)
  const totalSelling = items.reduce((sum, i) => {
    const p = resolveItemSellingPrice(i)
    return sum + (p != null ? p * i.quantity : 0)
  }, 0)
  const totalMrp = items.reduce((sum, i) => {
    const mrp = resolveItemMrp(i)
    return sum + (mrp != null ? mrp * i.quantity : 0)
  }, 0)
  // Only count selling/business price for items that actually have a target price (for discount comparison)
  const totalSellingForDiscountedItems = items.reduce((sum, i) => {
    if (reqInclGst(i) == null) return sum
    const p = resolveItemSellingPrice(i) ?? resolveItemMrp(i)
    return sum + (p != null ? p * i.quantity : 0)
  }, 0)
  const totalBusinessPriceForRequestedItems = items.reduce((sum, i) => {
    if (reqInclGst(i) == null) return sum
    const sell = resolveItemSellingPrice(i)
    if (sell == null) return sum
    const catId = i.product_category_id
    const pct = catId ? (discountMap[catId] ?? 0) : 0
    return sum + applyDiscount(sell, pct) * i.quantity
  }, 0)
  const totalBusinessPrice = items.reduce((sum, i) => {
    const sell = resolveItemSellingPrice(i)
    if (sell == null) return sum
    const catId = i.product_category_id
    const pct = catId ? (discountMap[catId] ?? 0) : 0
    return sum + applyDiscount(sell, pct) * i.quantity
  }, 0)
  // For header stat: prefer selling total, fallback to MRP total
  const totalCatalog = totalSelling > 0 ? totalSelling : totalMrp

  if (loading) return (
    <div className="p-4 sm:p-6 max-w-full space-y-5">
      <div className="animate-pulse space-y-4">
        <div className="h-7 w-48 bg-surface-secondary rounded" />
        <div className="h-4 w-64 bg-surface-secondary rounded" />
      </div>
      <div className="bg-surface-elevated border border-border-default rounded-xl overflow-hidden">
        <div className="p-4 space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 animate-pulse" style={{ animationDelay: `${i * 50}ms` }}>
              <div className="h-4 flex-1 bg-surface-secondary rounded" />
              <div className="h-4 w-20 bg-surface-secondary rounded" />
              <div className="h-4 w-20 bg-surface-secondary rounded" />
              <div className="h-4 w-16 bg-surface-secondary rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )

  if (!rfq) return <div className="p-6 text-center text-foreground-muted">RFQ not found.</div>

  return (
    <div className="p-4 sm:p-6 max-w-full space-y-5">
      {confirmOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={() => setConfirmOpen(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="bg-surface-elevated border border-border-default rounded-2xl shadow-2xl w-full max-w-sm pointer-events-auto p-6 space-y-4">
              <h3 className="text-base font-semibold text-foreground">Convert to Quotation?</h3>
              <p className="text-sm text-foreground-secondary">A draft quotation will be created with the prices from this RFQ. You can edit the rates in the quotation before sending.</p>
              <div className="flex gap-3 pt-1">
                <button onClick={doConvert} disabled={converting}
                  className="flex-1 px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                  {converting && <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  Convert
                </button>
                <button onClick={() => setConfirmOpen(false)}
                  className="px-4 py-2 border border-border-default text-sm font-medium rounded-lg hover:bg-surface-secondary transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-foreground-secondary">
        <Link href={ap('/admin/business/rfqs')} className="text-accent-500 hover:text-accent-600 transition-colors">Business RFQs</Link>
        <span>/</span>
        <span className="text-foreground font-mono">{rfq.rfq_number}</span>
      </div>

      {/* Header card */}
      <div className="bg-zinc-800 dark:bg-zinc-900 rounded-2xl p-6 text-white shadow-md border border-zinc-700 dark:border-zinc-800">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="w-14 h-14 rounded-xl bg-zinc-600 dark:bg-zinc-700 flex items-center justify-center text-xl font-bold font-mono shrink-0">
            RFQ
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold font-mono">{rfq.rfq_number}</h1>
              <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${STATUS_STYLES[rfq.status] || 'bg-zinc-500/20 text-zinc-300'}`}>
                {STATUS_LABEL[rfq.status] || rfq.status}
              </span>
            </div>
            <p className="text-zinc-400 text-sm mt-0.5">{rfq.company_name || rfq.email}</p>
            <p className="text-zinc-500 text-xs mt-0.5">
              Submitted {new Date(rfq.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </p>
          </div>
          <div className="shrink-0 flex flex-col items-end gap-2">
            {rfq.status === 'pending' && (
              <div className="flex items-center gap-2">
                <RequireWrite scope="business_rfqs:write">
                  <button onClick={() => handleStatusChange('reviewed')} disabled={actionLoading}
                    className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60">
                    Mark Reviewed
                  </button>
                  <button onClick={() => setShowRejectForm(s => !s)}
                    className="px-4 py-2 border border-red-400 text-red-300 text-sm font-semibold rounded-lg hover:bg-red-900/30 transition-colors">
                    Reject
                  </button>
                </RequireWrite>
              </div>
            )}
            {(rfq.status === 'reviewed' || rfq.status === 'negotiating' || rfq.status === 'offer_accepted') && (
              <RequireWrite scope="business_rfqs:write">
                <button onClick={() => setConfirmOpen(true)} disabled={converting}
                  className={`px-5 py-2 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60 flex items-center gap-2 ${rfq.status === 'offer_accepted' ? 'bg-teal-600 hover:bg-teal-700' : 'bg-accent-500 hover:bg-accent-600'}`}>
                  {converting && <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  {rfq.status === 'offer_accepted' ? 'Convert to Quotation ✓' : 'Convert to Quotation'}
                </button>
              </RequireWrite>
            )}
            {rfq.status === 'converted' && rfq.converted_quotation_id && (
              <div className="flex flex-col gap-2 items-end">
                <Link href={ap(`/admin/quotations/${rfq.converted_quotation_id}`)}
                  className="px-5 py-2 border-2 border-accent-500 text-accent-400 text-sm font-semibold rounded-lg hover:bg-accent-900/20 transition-colors">
                  View Quotation {rfq.quote_number ? `(${rfq.quote_number})` : ''} →
                </Link>
                {rfq.order_id && (
                  <Link href={ap(`/admin/invoices/${rfq.order_id}`)}
                    className="px-5 py-2 border-2 border-green-500 text-green-400 text-sm font-semibold rounded-lg hover:bg-green-900/20 transition-colors flex items-center gap-2">
                    View Invoice {rfq.invoice_number ? `(${rfq.invoice_number})` : ''} →
                    {rfq.order_status === 'draft' && (
                      <span className="text-xs font-normal text-orange-400">(draft)</span>
                    )}
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Items', value: String(items.length) },
            { label: 'Customer Price Total', value: totalCatalog > 0 ? `₹${fmt2(totalCatalog)}` : '—' },
            { label: 'Requested Value', value: totalRequested > 0 ? `₹${fmt2(totalRequested)}` : '—' },
            { label: 'GST Number', value: rfq.gst_number || '—' },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white/5 rounded-xl p-3.5 border border-white/10">
              <p className="text-zinc-400 text-xs mb-1">{label}</p>
              <p className="text-white font-semibold text-sm truncate">{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Reject form */}
      {showRejectForm && (
        <RequireWrite scope="business_rfqs:write">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 space-y-3">
          <p className="text-sm font-semibold text-red-700 dark:text-red-400">Reject this RFQ</p>
          <textarea value={adminNote} onChange={e => setAdminNote(e.target.value)}
            placeholder="Reason for rejection (shown to business customer)…"
            rows={3}
            className="w-full px-3 py-2 text-sm rounded-lg border border-red-300 dark:border-red-700 bg-surface focus:outline-none focus:ring-2 focus:ring-red-500 resize-none" />
          <div className="flex gap-2">
            <button onClick={() => handleStatusChange('rejected')} disabled={actionLoading}
              className="px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 transition-colors disabled:opacity-60">
              Confirm Reject
            </button>
            <button onClick={() => setShowRejectForm(false)}
              className="px-4 py-2 border border-border-default text-sm rounded-lg hover:bg-surface-secondary transition-colors">
              Cancel
            </button>
          </div>
        </div>
        </RequireWrite>
      )}

      {/* Offer accepted banner */}
      {rfq.status === 'offer_accepted' && (
        <div className="bg-teal-50 dark:bg-teal-900/20 border border-teal-300 dark:border-teal-700 rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-teal-500 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-teal-700 dark:text-teal-300">Customer accepted the offer</p>
              <p className="text-xs text-teal-600/80 dark:text-teal-500">Ready to convert — create the quotation now.</p>
            </div>
          </div>
          <RequireWrite scope="business_rfqs:write">
            <button
              onClick={() => setConfirmOpen(true)}
              disabled={converting}
              className="px-5 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60 flex items-center gap-2 shrink-0"
            >
              {converting && <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              Convert to Quotation
            </button>
          </RequireWrite>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Items — card layout */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">
              Requested Items <span className="ml-1 text-foreground-muted font-normal normal-case">({items.length})</span>
            </h2>
            {totalRequested > 0 && totalSellingForDiscountedItems > 0 && (
              <div className="flex items-center gap-3 text-xs text-foreground-muted">
                <span>
                  Customer:{' '}
                  <span className="font-semibold text-green-500">
                    {Math.round(((totalSellingForDiscountedItems - totalRequested) / totalSellingForDiscountedItems) * 100)}% off
                  </span>
                </span>
                {totalBusinessPriceForRequestedItems > 0 && totalBusinessPriceForRequestedItems !== totalSellingForDiscountedItems && totalBusinessPriceForRequestedItems > totalRequested && (
                  <span>
                    Business:{' '}
                    <span className="font-semibold text-blue-400">
                      {Math.round(((totalBusinessPriceForRequestedItems - totalRequested) / totalBusinessPriceForRequestedItems) * 100)}% off
                    </span>
                  </span>
                )}
              </div>
            )}
          </div>

          {items.length === 0 ? (
            <div className="bg-surface-elevated rounded-xl border border-border-default p-8 text-center text-foreground-muted text-sm">
              No items found.
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((item, i) => {
                const mrpPrice = resolveItemMrp(item)
                const sellingPrice = resolveItemSellingPrice(item)
                const catalogPrice = resolveItemPrice(item)
                const sku = resolveItemSku(item)
                const catId = item.product_category_id
                const businessDiscountPct = catId ? (discountMap[catId] ?? 0) : 0
                const businessPrice = sellingPrice != null && businessDiscountPct > 0
                  ? applyDiscount(sellingPrice, businessDiscountPct)
                  : null
                const itemCatalogTotal = catalogPrice != null ? catalogPrice * item.quantity : null
                const itemSellingTotal = sellingPrice != null ? sellingPrice * item.quantity : null
                const requestedInclGst = reqInclGst(item)
                const itemRequestedTotal = requestedInclGst != null ? requestedInclGst * item.quantity : null

                // Default discount: MRP → Customer Price
                const defaultDiscountPct = (mrpPrice != null && mrpPrice > 0 && sellingPrice != null && mrpPrice > sellingPrice)
                  ? Math.round(((mrpPrice - sellingPrice) / mrpPrice) * 100)
                  : null
                // Requested discount: off Business Price (if assigned), else off Customer Price
                // baseForRequestedDiscount is incl-GST; requestedInclGst is also converted incl-GST
                const baseForRequestedDiscount = businessPrice ?? sellingPrice ?? mrpPrice ?? null
                const requestedDiscountPct = (requestedInclGst != null && baseForRequestedDiscount != null && baseForRequestedDiscount > 0)
                  ? Math.round(((baseForRequestedDiscount - requestedInclGst) / baseForRequestedDiscount) * 100)
                  : null
                const hasAnyBanner = defaultDiscountPct != null || businessDiscountPct > 0 || (requestedDiscountPct != null)
                const hasDiscount = requestedDiscountPct != null && requestedDiscountPct > 0

                return (
                  <div key={item.id} className={`bg-surface-elevated rounded-xl border overflow-hidden ${hasDiscount ? 'border-green-400/40 dark:border-green-600/40' : 'border-border-default'}`}>
                    {/* Discount tier banner */}
                    {hasAnyBanner && (
                      <div className="flex flex-wrap items-center gap-x-0 border-b border-border-default/60 text-[11px] divide-x divide-border-default/40">
                        {defaultDiscountPct != null && (
                          <div className="flex items-center gap-1.5 px-4 py-1.5 bg-zinc-500/10">
                            <span className="text-foreground-muted">Default:</span>
                            <span className="font-semibold text-foreground-secondary">{defaultDiscountPct}% off MRP</span>
                          </div>
                        )}
                        {businessDiscountPct > 0 && (
                          <div className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-500/10">
                            <span className="text-blue-400/70">Business:</span>
                            <span className="font-semibold text-blue-400">{businessDiscountPct}% off customer price</span>
                          </div>
                        )}
                        {requestedDiscountPct != null && requestedDiscountPct > 0 && (
                          <div className="flex items-center gap-1.5 px-4 py-1.5 bg-green-500/10">
                            <span className="text-green-400/70">Requested:</span>
                            <span className="font-semibold text-green-400">{requestedDiscountPct}% off {businessPrice != null ? 'business price' : 'customer price'}</span>
                          </div>
                        )}
                        {requestedDiscountPct != null && requestedDiscountPct <= 0 && requestedInclGst != null && (
                          <div className="flex items-center gap-1.5 px-4 py-1.5 bg-amber-500/10">
                            <span className="text-amber-400/70">Requested:</span>
                            <span className="font-semibold text-amber-400">At/above {businessPrice != null ? 'business' : 'customer'} price</span>
                          </div>
                        )}
                        {(() => {
                          // Effective price = min(requested, business, customer); anchor = MRP
                          const effectivePrice = requestedInclGst != null
                            ? (businessPrice != null && businessPrice < requestedInclGst ? businessPrice : requestedInclGst)
                            : businessPrice ?? sellingPrice ?? null
                          if (mrpPrice != null && mrpPrice > 0 && effectivePrice != null && effectivePrice < mrpPrice) {
                            const effPct = Math.round(((mrpPrice - effectivePrice) / mrpPrice) * 100)
                            return (
                              <div className="ml-auto flex items-center gap-1.5 px-4 py-1.5 bg-purple-500/10">
                                <span className="text-purple-400/70">Effective:</span>
                                <span className="font-semibold text-purple-400">{effPct}% off MRP</span>
                              </div>
                            )
                          }
                          return null
                        })()}
                      </div>
                    )}

                    <div className="flex gap-0">
                      {/* Position number */}
                      <div className="flex items-center justify-center w-10 shrink-0 bg-surface-secondary border-r border-border-default">
                        <span className="text-xs font-mono text-foreground-muted">{i + 1}</span>
                      </div>

                      {/* Product image */}
                      <div className="w-20 h-20 shrink-0 bg-surface border-r border-border-default overflow-hidden self-stretch flex items-center justify-center">
                        {item.product_image_url ? (
                          <img
                            src={item.product_image_url}
                            alt={item.description}
                            className="w-full h-full object-contain p-1.5"
                          />
                        ) : (
                          <svg className="w-8 h-8 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                          </svg>
                        )}
                      </div>

                      {/* Main content */}
                      <div className="flex-1 min-w-0 p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            {/* Description (what the customer typed) */}
                            <p className="font-semibold text-foreground text-sm leading-snug">{item.description}</p>

                            {/* Resolved product/variant names */}
                            {(item.product_name || item.variant_name || item.sub_variant_name) && (
                              <p className="text-xs text-foreground-muted mt-0.5">
                                {[item.product_name, item.variant_name, item.sub_variant_name].filter(Boolean).join(' — ')}
                              </p>
                            )}

                            {/* SKU + qty */}
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1.5">
                              {sku && (
                                <span className="text-[11px] font-mono text-foreground-muted bg-surface px-1.5 py-0.5 rounded border border-border-default inline-flex items-center gap-1">
                                  SKU: {sku}<CopySku sku={sku} />
                                </span>
                              )}
                              <span className="text-xs text-foreground-secondary">
                                Qty: <span className="font-semibold text-foreground">{item.quantity} {item.unit}</span>
                              </span>
                            </div>

                            {/* Item notes */}
                            {item.notes && (
                              <p className="text-xs text-foreground-muted italic mt-1.5 border-l-2 border-accent-300 dark:border-accent-700 pl-2">
                                {item.notes}
                              </p>
                            )}
                          </div>

                          {/* Price column */}
                          <div className="shrink-0 text-right space-y-2 min-w-[130px]">
                            {/* MRP — only show if higher than selling price (guards bad data) */}
                            {mrpPrice != null && (sellingPrice == null || mrpPrice >= sellingPrice) && (
                              <div>
                                <p className="text-[10px] text-foreground-muted uppercase tracking-wide">MRP</p>
                                <p className="text-sm text-foreground-muted line-through decoration-foreground-muted/50">
                                  ₹{fmt2(mrpPrice)}
                                </p>
                              </div>
                            )}
                            {/* Selling price (what regular customer pays online) */}
                            {sellingPrice != null && (
                              <div>
                                <p className="text-[10px] text-foreground-muted uppercase tracking-wide">Customer Price</p>
                                <p className="text-sm font-medium text-foreground">
                                  ₹{fmt2(sellingPrice)}
                                  <span className="text-foreground-muted text-[10px] ml-0.5">/unit</span>
                                </p>
                              </div>
                            )}
                            {/* Business price — customer price after their assigned category discount */}
                            {businessPrice != null && (
                              <div>
                                <p className="text-[10px] text-foreground-muted uppercase tracking-wide">
                                  Business Price <span className="normal-case">({businessDiscountPct}% off)</span>
                                </p>
                                <p className="text-sm font-medium text-blue-600 dark:text-blue-400">
                                  ₹{fmt2(businessPrice)}
                                  <span className="text-foreground-muted text-[10px] ml-0.5">/unit</span>
                                </p>
                              </div>
                            )}
                            {/* Requested price */}
                            {requestedInclGst != null ? (
                              <div>
                                <p className="text-[10px] text-foreground-muted uppercase tracking-wide">Requested</p>
                                <p className="text-sm font-bold text-accent-500">
                                  ₹{fmt2(requestedInclGst)}
                                  <span className="text-foreground-muted font-normal text-[10px] ml-0.5">/unit</span>
                                </p>
                              </div>
                            ) : (
                              <div>
                                <p className="text-[10px] text-foreground-muted uppercase tracking-wide">Requested</p>
                                <p className="text-xs text-foreground-muted">No target price</p>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Line totals */}
                        {(itemCatalogTotal != null || itemSellingTotal != null || itemRequestedTotal != null) && (
                          <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border-default flex-wrap">
                            {itemSellingTotal != null && (
                              <div className="text-xs text-foreground-muted">
                                Customer price total:&nbsp;
                                <span className="text-foreground font-medium">
                                  ₹{fmt2(itemSellingTotal)}
                                </span>
                              </div>
                            )}
                            {itemRequestedTotal != null && (
                              <div className="text-xs text-foreground-muted">
                                Requested total:&nbsp;
                                <span className="font-semibold text-accent-500">
                                  ₹{fmt2(itemRequestedTotal)}
                                </span>
                              </div>
                            )}
                            {(() => {
                              // Effective total = min(requested, business price, customer price)
                              const businessItemTotal = sellingPrice != null && businessDiscountPct > 0
                                ? applyDiscount(sellingPrice, businessDiscountPct) * item.quantity
                                : null
                              const effectiveTotal = itemRequestedTotal != null
                                ? (businessItemTotal != null && businessItemTotal < itemRequestedTotal ? businessItemTotal : itemRequestedTotal)
                                : businessItemTotal
                              // Saves = MRP total - effective total (fall back to customer price if no MRP)
                              const savesBase = mrpPrice != null ? mrpPrice * item.quantity : itemSellingTotal
                              if (savesBase != null && effectiveTotal != null && savesBase > effectiveTotal) {
                                return (
                                  <div className="ml-auto text-xs text-green-600 dark:text-green-400 font-medium">
                                    Saves ₹{fmt2(savesBase - effectiveTotal)}
                                  </div>
                                )
                              }
                              return null
                            })()}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Summary row */}
          {(totalMrp > 0 || totalSelling > 0 || totalRequested > 0) && (
            <div className="bg-surface-elevated rounded-xl border border-border-default p-4 flex flex-wrap items-center gap-6">
              {totalMrp > 0 && (
                <div>
                  <p className="text-xs text-foreground-muted mb-0.5">Total MRP</p>
                  <p className="font-medium text-foreground-secondary line-through decoration-foreground-muted/50">₹{fmt2(totalMrp)}</p>
                </div>
              )}
              {totalSelling > 0 && (
                <div>
                  <p className="text-xs text-foreground-muted mb-0.5">Total Customer Price</p>
                  <p className="font-semibold text-foreground">₹{fmt2(totalSelling)}</p>
                </div>
              )}
              {totalBusinessPrice > 0 && totalBusinessPrice !== totalSelling && (
                <div>
                  <p className="text-xs text-foreground-muted mb-0.5">Total Business Price</p>
                  <p className="font-semibold text-blue-600 dark:text-blue-400">₹{fmt2(totalBusinessPrice)}</p>
                </div>
              )}
              {totalRequested > 0 && (
                <div>
                  <p className="text-xs text-foreground-muted mb-0.5">Total Requested</p>
                  <p className="font-bold text-accent-500">₹{fmt2(totalRequested)}</p>
                </div>
              )}
              {totalSellingForDiscountedItems > 0 && totalRequested > 0 && (
                <div className="ml-auto flex items-start gap-5">
                  {totalSellingForDiscountedItems > totalBusinessPriceForRequestedItems && totalBusinessPriceForRequestedItems > 0 && (
                    <div className="text-right">
                      <p className="text-xs text-foreground-muted mb-0.5">Discount off Customer Price</p>
                      <p className="font-bold text-green-600 dark:text-green-400">
                        ₹{fmt2(totalSellingForDiscountedItems - totalBusinessPriceForRequestedItems)}
                        <span className="text-xs font-normal text-foreground-muted ml-1">
                          ({Math.round(((totalSellingForDiscountedItems - totalBusinessPriceForRequestedItems) / totalSellingForDiscountedItems) * 100)}%)
                        </span>
                      </p>
                    </div>
                  )}
                  {totalSellingForDiscountedItems > totalRequested && totalBusinessPriceForRequestedItems === 0 && (
                    <div className="text-right">
                      <p className="text-xs text-foreground-muted mb-0.5">Discount off Customer Price</p>
                      <p className="font-bold text-green-600 dark:text-green-400">
                        ₹{fmt2(totalSellingForDiscountedItems - totalRequested)}
                        <span className="text-xs font-normal text-foreground-muted ml-1">
                          ({Math.round(((totalSellingForDiscountedItems - totalRequested) / totalSellingForDiscountedItems) * 100)}%)
                        </span>
                      </p>
                    </div>
                  )}
                  {totalBusinessPriceForRequestedItems > 0 && totalBusinessPriceForRequestedItems !== totalSellingForDiscountedItems && totalBusinessPriceForRequestedItems > totalRequested && (
                    <div className="text-right">
                      <p className="text-xs text-foreground-muted mb-0.5">Discount off Business Price</p>
                      <p className="font-bold text-blue-500 dark:text-blue-400">
                        ₹{fmt2(totalBusinessPriceForRequestedItems - totalRequested)}
                        <span className="text-xs font-normal text-foreground-muted ml-1">
                          ({Math.round(((totalBusinessPriceForRequestedItems - totalRequested) / totalBusinessPriceForRequestedItems) * 100)}%)
                        </span>
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right — customer details + notes */}
        <div className="space-y-5">
          {/* From */}
          <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
            <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-4">From</h2>
            <dl className="space-y-3 text-sm">
              {[
                ['Company', rfq.company_name || '—'],
                ['Contact', `${rfq.first_name} ${rfq.last_name || ''}`.trim()],
                ['Email', rfq.email],
                ['Phone', rfq.phone ? `+91 ${rfq.phone}` : '—'],
                ['GST', rfq.gst_number || '—'],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-foreground-muted text-xs mb-0.5">{label}</dt>
                  <dd className="text-foreground font-medium break-all">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 pt-4 border-t border-border-default">
              <Link href={ap(`/admin/business/customers/${rfq.user_id}`)}
                className="text-xs text-accent-500 hover:text-accent-600 font-medium">
                View customer profile →
              </Link>
            </div>
          </div>

          {/* Customer notes */}
          {rfq.notes && (
            <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
              <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-3">Customer Note</h2>
              <p className="text-sm text-foreground whitespace-pre-line">{rfq.notes}</p>
            </div>
          )}

          {/* Admin note */}
          {rfq.admin_note && (
            <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
              <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-3">Admin Note</h2>
              <p className="text-sm text-foreground whitespace-pre-line">{rfq.admin_note}</p>
            </div>
          )}

          {/* Converted banner */}
          {rfq.status === 'converted' && rfq.converted_quotation_id && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4 space-y-3">
              <div>
                <p className="text-sm text-green-700 dark:text-green-400 font-medium mb-1">Converted to quotation</p>
                <Link href={ap(`/admin/quotations/${rfq.converted_quotation_id}`)}
                  className="text-sm font-semibold text-accent-600 dark:text-accent-400 hover:underline">
                  Open Quotation {rfq.quote_number ? `(${rfq.quote_number})` : ''} →
                </Link>
              </div>
              {rfq.order_id && (
                <div className="pt-3 border-t border-green-200 dark:border-green-800">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-sm text-green-700 dark:text-green-400 font-medium">Invoice raised</p>
                    {rfq.order_status === 'draft' && (
                      <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                        Draft
                      </span>
                    )}
                    {rfq.invoice_payment_status && rfq.order_status !== 'draft' && (
                      <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                        rfq.invoice_payment_status === 'paid'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : rfq.invoice_payment_status === 'partial'
                            ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                            : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                      }`}>
                        {rfq.invoice_payment_status === 'paid' ? 'Paid' : rfq.invoice_payment_status === 'partial' ? 'Partially paid' : 'Unpaid'}
                      </span>
                    )}
                  </div>
                  {rfq.invoice_total && (
                    <p className="text-xs text-foreground-muted mb-1.5">
                      Total: <span className="font-semibold text-foreground">₹{Number(rfq.invoice_total).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                    </p>
                  )}
                  <Link href={ap(`/admin/invoices/${rfq.order_id}`)}
                    className="text-sm font-semibold text-accent-600 dark:text-accent-400 hover:underline">
                    Open Invoice {rfq.invoice_number ? `(${rfq.invoice_number})` : ''} →
                  </Link>
                </div>
              )}
            </div>
          )}

          {/* Negotiation thread */}
          {!['converted', 'rejected', 'offer_accepted'].includes(rfq.status) || messages.length > 0 ? (
            <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-border-default">
                <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">Negotiation Thread</h2>
                {messages.length > 0 && (
                  <span className="text-xs text-foreground-muted">{messages.length} message{messages.length !== 1 ? 's' : ''}</span>
                )}
              </div>

              {/* Message thread */}
              <div ref={threadRef} className="max-h-80 overflow-y-auto p-4 space-y-3">
                {messages.length === 0 ? (
                  <p className="text-xs text-foreground-muted text-center py-4">No messages yet. Start the negotiation below.</p>
                ) : messages.map(msg => {
                  const isAdmin = msg.sender === 'admin'
                  return (
                    <div key={msg.id} className={`flex flex-col gap-1 ${isAdmin ? 'items-end' : 'items-start'}`}>
                      <div className={`flex items-end gap-2 ${isAdmin ? 'flex-row-reverse' : ''}`}>
                        {/* Avatar */}
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${isAdmin ? 'bg-accent-500 text-white' : 'bg-purple-500/20 text-purple-400'}`}>
                          {isAdmin ? 'A' : 'C'}
                        </div>
                        {/* Bubble */}
                        <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${isAdmin ? 'bg-accent-500/10 border border-accent-500/30 text-foreground rounded-br-sm' : 'bg-surface border border-border-default text-foreground rounded-bl-sm'}`}>
                          {msg.message}
                        </div>
                      </div>
                      {/* Counter items card */}
                      {msg.counter_items && msg.counter_items.length > 0 && (
                        <div className="mr-8 bg-purple-500/10 border border-purple-500/30 rounded-xl p-3 space-y-1 w-full max-w-[85%]">
                          <p className="text-[10px] font-semibold text-purple-400 uppercase tracking-wide mb-1.5">Counter Prices</p>
                          {msg.counter_items.map(ci => {
                            const item = items.find(it => it.id === ci.rfq_item_id)
                            return (
                              <div key={ci.rfq_item_id} className="flex items-center justify-between gap-2 text-xs">
                                <span className="text-foreground-secondary truncate">{item?.description || ci.rfq_item_id}</span>
                                <span className="font-semibold text-purple-300 shrink-0">₹{fmt2(Number(ci.offered_price))}/unit</span>
                              </div>
                            )
                          })}
                        </div>
                      )}
                      <span className="text-[10px] text-foreground-muted px-8">{fmtTime(msg.created_at)}</span>
                    </div>
                  )
                })}
              </div>

              {/* Reply composer — hidden once customer has accepted */}
              {!['converted', 'rejected', 'offer_accepted'].includes(rfq.status) && (
                <RequireWrite scope="business_rfqs:write">
                {['pending', 'reviewed'].includes(rfq.status) ? (
                  /* Quick-send chips for early stages — no free-text, structured actions only */
                  <div className="border-t border-border-default p-4 space-y-4">
                    <p className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wide">Quick Replies</p>
                    <div className="grid grid-cols-1 gap-2">
                      {[
                        'We\'ve received your request and are reviewing it.',
                        'Could you please provide more details about your requirements?',
                        'We\'re preparing a counter offer for you shortly.',
                        'We can accommodate this request. We\'ll send pricing soon.',
                        'Thank you for your inquiry. We\'ll get back to you by end of day.',
                      ].map(preset => (
                        <button
                          key={preset}
                          type="button"
                          disabled={sendingReply}
                          onClick={() => setReplyText(prev => prev === preset ? '' : preset)}
                          className={`w-full text-left px-3 py-1.5 text-xs rounded-xl border transition-colors ${
                            replyText === preset
                              ? 'bg-accent-500/15 border-accent-500/50 text-foreground font-medium'
                              : 'bg-surface border-border-default text-foreground-secondary hover:bg-surface-elevated hover:text-foreground hover:border-accent-500/30'
                          }`}
                        >
                          {preset}
                        </button>
                      ))}
                    </div>

                    {/* Counter price offer — primary action */}
                    <button
                      type="button"
                      onClick={() => setShowCounterForm(s => !s)}
                      className="w-full text-xs text-purple-400 hover:text-purple-300 font-medium flex items-center gap-1.5 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d={showCounterForm ? 'M19 9l-7 7-7-7' : 'M9 5l7 7-7 7'} />
                      </svg>
                      {showCounterForm ? 'Hide counter prices' : 'Make an offer — attach counter prices'}
                    </button>

                    {showCounterForm && (
                      <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl p-3 space-y-2">
                        <p className="text-[10px] text-purple-400 font-semibold uppercase tracking-wide mb-2">Counter Price per Item (incl. GST)</p>
                        {items.map(item => (
                          <div key={item.id} className="flex items-center gap-2">
                            <span className="flex-1 text-xs text-foreground-secondary truncate">{item.description}</span>
                            <div className="relative shrink-0 w-28">
                              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-foreground-muted">₹</span>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder={reqInclGst(item) != null ? String(reqInclGst(item)) : '—'}
                                value={counterInputs[item.id] ?? ''}
                                onChange={e => setCounterInputs(prev => ({ ...prev, [item.id]: e.target.value }))}
                                className="w-full pl-6 pr-2 py-1.5 text-xs bg-surface border border-border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-purple-500"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <button
                      onClick={handleSendReply}
                      disabled={sendingReply || !replyText.trim()}
                      className="w-full px-4 py-2 bg-accent-500 hover:bg-accent-600 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                    >
                      {sendingReply && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                      Send
                    </button>
                  </div>
                ) : (
                  /* Full composer for negotiating state */
                  <div className="border-t border-border-default p-4 space-y-3">
                    <p className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wide">Quick Replies</p>
                    <div className="grid grid-cols-1 gap-2">
                      {[
                        'Thanks for the counter. We\'re reviewing it and will respond shortly.',
                        'We\'ve adjusted our pricing — please review the latest counter offer.',
                        'That\'s the best price we can offer for this quantity.',
                        'Could you increase the quantity? It will help us offer a better price.',
                        'We can match this price. Shall we proceed to a final quotation?',
                      ].map(preset => (
                        <button
                          key={preset}
                          type="button"
                          disabled={sendingReply}
                          onClick={() => setReplyText(prev => prev === preset ? '' : preset)}
                          className={`w-full text-left px-3 py-1.5 text-xs rounded-xl border transition-colors ${
                            replyText === preset
                              ? 'bg-accent-500/15 border-accent-500/50 text-foreground font-medium'
                              : 'bg-surface border-border-default text-foreground-secondary hover:bg-surface-elevated hover:text-foreground hover:border-accent-500/30'
                          }`}
                        >
                          {preset}
                        </button>
                      ))}
                    </div>

                    <textarea
                      value={replyText}
                      onChange={e => setReplyText(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendReply() } }}
                      placeholder="Type a reply… (Enter to send, Shift+Enter for new line)"
                      rows={3}
                      className="w-full px-3 py-2 text-sm bg-surface border border-border-default rounded-xl focus:outline-none focus:ring-2 focus:ring-accent-500 resize-none"
                    />

                    <button
                      type="button"
                      onClick={() => setShowCounterForm(s => !s)}
                      className="text-xs text-purple-400 hover:text-purple-300 font-medium flex items-center gap-1.5 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d={showCounterForm ? 'M19 9l-7 7-7-7' : 'M9 5l7 7-7 7'} />
                      </svg>
                      {showCounterForm ? 'Hide counter prices' : 'Attach counter prices (optional)'}
                    </button>

                    {showCounterForm && (
                      <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl p-3 space-y-2">
                        <p className="text-[10px] text-purple-400 font-semibold uppercase tracking-wide mb-2">Counter Price per Item (incl. GST)</p>
                        {items.map(item => (
                          <div key={item.id} className="flex items-center gap-2">
                            <span className="flex-1 text-xs text-foreground-secondary truncate">{item.description}</span>
                            <div className="relative shrink-0 w-28">
                              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-foreground-muted">₹</span>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder={reqInclGst(item) != null ? String(reqInclGst(item)) : '—'}
                                value={counterInputs[item.id] ?? ''}
                                onChange={e => setCounterInputs(prev => ({ ...prev, [item.id]: e.target.value }))}
                                className="w-full pl-6 pr-2 py-1.5 text-xs bg-surface border border-border-default rounded-lg focus:outline-none focus:ring-1 focus:ring-purple-500"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <button
                      onClick={handleSendReply}
                      disabled={sendingReply || !replyText.trim()}
                      className="w-full px-4 py-2 bg-accent-500 hover:bg-accent-600 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                    >
                      {sendingReply && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                      Send Reply
                    </button>
                  </div>
                )
                </RequireWrite>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
