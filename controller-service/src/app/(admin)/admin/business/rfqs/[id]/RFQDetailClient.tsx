'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import CopySku from '@/components/ui/CopySku'
import { ap } from '@/lib/shared/admin-path'
import { useCanWrite, RequireWrite } from '@/contexts/AdminScopesContext'
import { Card, DetailHeader, DetailSkeleton, Dialog, EmptyState, EntityPage, Field, Fields, Kpi, KpiGrid, StatusBadge, TextArea, badgeCls, fieldInputCls, useActionToast } from '@/components/admin/kit'
import { RFQ_STATUS, fmtDay } from '../../_status'
import { round2 } from '@/lib/catalog/gst'
import { fmtQty } from '@/lib/shared/number-display'

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

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending Review',
  reviewed: 'Reviewed',
  negotiating: 'Negotiating',
  offer_accepted: 'Offer Accepted',
  converted: 'Converted to Quotation',
  rejected: 'Rejected',
}

function fmt2(n: number) {
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtTime(iso: string) {
  return (
    new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) +
    ', ' +
    new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  )
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
    return round2(Number(rawMrp) * (1 + gstRate / 100) * unitFactor)
  }
  return round2(mrp)
}

function resolveItemSellingPrice(item: RFQItem): number | null {
  const unitFactor = item.unit_factor > 1 ? item.unit_factor : 1
  const raw = item.sub_variant_price ?? item.variant_price ?? item.base_price ?? null
  return raw != null ? round2(Number(raw) * unitFactor) : null
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
  const toast = useActionToast()
  const showToast = (msg: string, type: 'success' | 'error' = 'success') => (type === 'error' ? toast.error(msg) : toast.success(msg))
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
      .then(r => (r.ok ? r.json() : { messages: [] }))
      .then(m => setMessages(m.messages || []))
      .catch(() => {
        /* messages table may not exist yet */
      })
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
      setRfq(r => (r ? { ...r, status, admin_note: adminNote } : r))
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
    const res = await fetch(`/api/admin/business/rfqs/${id}/convert-to-quotation`, {
      method: 'POST',
      credentials: 'include',
    })
    const data = await res.json()
    if (res.ok) {
      setRfq(r => (r ? { ...r, status: 'converted', converted_quotation_id: data.quotationId } : r))
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
      setRfq(r => (r && r.status !== 'negotiating' ? { ...r, status: 'negotiating' } : r))
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

  if (loading)
    return (
      <div className="p-4 sm:p-6">
        <DetailSkeleton kpis={4} />
      </div>
    )

  if (!rfq)
    return (
      <div className="p-4 sm:p-6">
        <EmptyState title="RFQ not found." />
      </div>
    )

  const spinner = <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
  const counterPrices = (
    <div className="space-y-2 rounded-xl border border-border-default bg-surface-secondary/40 p-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">Counter Price per Item (incl. GST)</p>
      {items.map(item => (
        <div key={item.id} className="flex items-center gap-2">
          <span className="flex-1 truncate text-xs text-foreground-secondary">{item.description}</span>
          <div className="relative w-28 shrink-0">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-foreground-muted">₹</span>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder={reqInclGst(item) != null ? String(reqInclGst(item)) : '—'}
              value={counterInputs[item.id] ?? ''}
              onChange={e => setCounterInputs(prev => ({ ...prev, [item.id]: e.target.value }))}
              className={`${fieldInputCls} pl-6 pr-2 text-xs tabular-nums`}
            />
          </div>
        </div>
      ))}
    </div>
  )
  const presetChips = (presets: string[]) => (
    <div className="grid grid-cols-1 gap-2">
      {presets.map(preset => (
        <button
          key={preset}
          type="button"
          disabled={sendingReply}
          onClick={() => setReplyText(prev => (prev === preset ? '' : preset))}
          className={`w-full rounded-lg border px-3 py-1.5 text-left text-xs transition-colors ${
            replyText === preset ? 'border-accent-500/50 bg-accent-500/10 font-medium text-foreground' : 'border-border-default bg-surface text-foreground-secondary hover:border-accent-500/30 hover:text-foreground'
          }`}
        >
          {preset}
        </button>
      ))}
    </div>
  )
  const counterToggle = (label: string) => (
    <button type="button" onClick={() => setShowCounterForm(s => !s)} className="flex items-center gap-1.5 text-xs font-medium text-accent-500 hover:text-accent-600">
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d={showCounterForm ? 'M19 9l-7 7-7-7' : 'M9 5l7 7-7 7'} />
      </svg>
      {showCounterForm ? 'Hide counter prices' : label}
    </button>
  )
  const sendButton = (label: string) => (
    <button onClick={handleSendReply} disabled={sendingReply || !replyText.trim()} className="control-md w-full bg-accent-500 font-semibold text-white hover:bg-accent-600 disabled:opacity-50">
      {sendingReply && spinner}
      {label}
    </button>
  )

  return (
    <>
      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Convert to Quotation?"
        size="sm"
        footer={
          <>
            <button onClick={() => setConfirmOpen(false)} className="control-md border border-border-default text-foreground hover:bg-surface-secondary">
              Cancel
            </button>
            <button onClick={doConvert} disabled={converting} className="control-md bg-accent-500 font-semibold text-white hover:bg-accent-600 disabled:opacity-60">
              {converting && spinner}
              Convert
            </button>
          </>
        }
      >
        <p className="text-sm text-foreground-secondary">A draft quotation will be created with the prices from this RFQ. You can edit the rates in the quotation before sending.</p>
      </Dialog>
      <EntityPage
      header={
        <DetailHeader
          back={{ href: ap('/admin/business/rfqs'), label: 'Business RFQs' }}
          title={<span className="font-mono">{rfq.rfq_number}</span>}
          status={<StatusBadge status={rfq.status} map={RFQ_STATUS} label={STATUS_LABEL[rfq.status]} />}
          subtitle={rfq.company_name || rfq.email}
          identifiers={[{ label: 'Submitted', value: fmtDay(rfq.created_at) }]}
          actions={
            <>
              {rfq.status === 'pending' && (
                <RequireWrite scope="business_rfqs:write">
                  <button onClick={() => setShowRejectForm(s => !s)} className="control-md border border-red-500/40 font-semibold text-red-600 hover:bg-red-500/10 dark:text-red-400">
                    Reject
                  </button>
                  <button onClick={() => handleStatusChange('reviewed')} disabled={actionLoading} className="control-md bg-accent-500 font-semibold text-white hover:bg-accent-600 disabled:opacity-60">
                    Mark Reviewed
                  </button>
                </RequireWrite>
              )}
              {(rfq.status === 'reviewed' || rfq.status === 'negotiating' || rfq.status === 'offer_accepted') && (
                <RequireWrite scope="business_rfqs:write">
                  <button onClick={() => setConfirmOpen(true)} disabled={converting} className="control-md bg-accent-500 font-semibold text-white hover:bg-accent-600 disabled:opacity-60">
                    {converting && spinner}
                    {rfq.status === 'offer_accepted' ? 'Convert to Quotation ✓' : 'Convert to Quotation'}
                  </button>
                </RequireWrite>
              )}
              {rfq.status === 'converted' && rfq.converted_quotation_id && (
                <>
                  {rfq.order_id && (
                    <Link href={ap(`/admin/invoices/${rfq.order_id}/view`)} className="control-md border border-border-default bg-surface-elevated font-medium text-foreground hover:bg-surface-secondary">
                      View Invoice {rfq.invoice_number ? `(${rfq.invoice_number})` : ''}
                      {rfq.order_status === 'draft' && <span className={badgeCls('amber')}>Draft</span>}
                    </Link>
                  )}
                  <Link href={ap(`/admin/quotations/${rfq.converted_quotation_id}/view`)} className="control-md bg-accent-500 font-semibold text-white hover:bg-accent-600">
                    View Quotation {rfq.quote_number ? `(${rfq.quote_number})` : ''}
                  </Link>
                </>
              )}
            </>
          }
        />
      }
      kpis={
        <KpiGrid>
          <Kpi label="Items" value={String(items.length)} />
          <Kpi label="Customer price total" value={totalCatalog > 0 ? `₹${fmt2(totalCatalog)}` : '-'} />
          <Kpi label="Requested value" value={totalRequested > 0 ? `₹${fmt2(totalRequested)}` : '-'} highlight={totalRequested > 0} />
          <Kpi label="GST number" value={rfq.gst_number || '-'} />
        </KpiGrid>
      }
      notices={
        <>
          {showRejectForm && (
            <RequireWrite scope="business_rfqs:write">
              <div className="space-y-3 rounded-xl border border-red-500/40 bg-red-500/5 p-4">
                <p className="text-sm font-semibold text-red-600 dark:text-red-400">Reject this RFQ</p>
                <TextArea value={adminNote} onChange={e => setAdminNote(e.target.value)} placeholder="Reason for rejection (shown to business customer)…" rows={3} className="resize-none" />
                <div className="flex gap-2">
                  <button onClick={() => handleStatusChange('rejected')} disabled={actionLoading} className="control-md bg-red-600 font-semibold text-white hover:bg-red-700 disabled:opacity-60">
                    Confirm Reject
                  </button>
                  <button onClick={() => setShowRejectForm(false)} className="control-md border border-border-default text-foreground hover:bg-surface-secondary">
                    Cancel
                  </button>
                </div>
              </div>
            </RequireWrite>
          )}
          {rfq.status === 'offer_accepted' && (
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-green-500/40 bg-green-500/5 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-600">
                  <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-green-700 dark:text-green-400">Customer accepted the offer</p>
                  <p className="text-xs text-foreground-muted">Ready to convert — create the quotation now.</p>
                </div>
              </div>
              <RequireWrite scope="business_rfqs:write">
                <button onClick={() => setConfirmOpen(true)} disabled={converting} className="control-md shrink-0 bg-green-600 font-semibold text-white hover:bg-green-700 disabled:opacity-60">
                  {converting && spinner}
                  Convert to Quotation
                </button>
              </RequireWrite>
            </div>
          )}
        </>
      }
      main={
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">
              Requested items <span className="ml-1 font-normal normal-case text-foreground-muted">({items.length})</span>
            </h2>
            {totalRequested > 0 && totalSellingForDiscountedItems > 0 && (
              <div className="flex items-center gap-3 text-xs text-foreground-muted">
                <span>
                  Customer:{' '}
                  <span className="font-semibold text-green-600 dark:text-green-400">
                    {Math.round(
                      ((totalSellingForDiscountedItems - totalRequested) / totalSellingForDiscountedItems) * 100
                    )}
                    % off
                  </span>
                </span>
                {totalBusinessPriceForRequestedItems > 0 &&
                  totalBusinessPriceForRequestedItems !== totalSellingForDiscountedItems &&
                  totalBusinessPriceForRequestedItems > totalRequested && (
                    <span>
                      Business:{' '}
                      <span className="font-semibold text-blue-700 dark:text-blue-400">
                        {Math.round(
                          ((totalBusinessPriceForRequestedItems - totalRequested) /
                            totalBusinessPriceForRequestedItems) *
                            100
                        )}
                        % off
                      </span>
                    </span>
                  )}
              </div>
            )}
          </div>

          {items.length === 0 ? (
            <EmptyState title="No items found." />
          ) : (
            <div className="space-y-3">
              {items.map((item, i) => {
                const mrpPrice = resolveItemMrp(item)
                const sellingPrice = resolveItemSellingPrice(item)
                const catalogPrice = resolveItemPrice(item)
                const sku = resolveItemSku(item)
                const catId = item.product_category_id
                const businessDiscountPct = catId ? (discountMap[catId] ?? 0) : 0
                const businessPrice =
                  sellingPrice != null && businessDiscountPct > 0
                    ? applyDiscount(sellingPrice, businessDiscountPct)
                    : null
                const itemCatalogTotal = catalogPrice != null ? catalogPrice * item.quantity : null
                const itemSellingTotal = sellingPrice != null ? sellingPrice * item.quantity : null
                const requestedInclGst = reqInclGst(item)
                const itemRequestedTotal = requestedInclGst != null ? requestedInclGst * item.quantity : null

                // Default discount: MRP → Customer Price
                const defaultDiscountPct =
                  mrpPrice != null && mrpPrice > 0 && sellingPrice != null && mrpPrice > sellingPrice
                    ? Math.round(((mrpPrice - sellingPrice) / mrpPrice) * 100)
                    : null
                // Requested discount: off Business Price (if assigned), else off Customer Price
                // baseForRequestedDiscount is incl-GST; requestedInclGst is also converted incl-GST
                const baseForRequestedDiscount = businessPrice ?? sellingPrice ?? mrpPrice ?? null
                const requestedDiscountPct =
                  requestedInclGst != null && baseForRequestedDiscount != null && baseForRequestedDiscount > 0
                    ? Math.round(((baseForRequestedDiscount - requestedInclGst) / baseForRequestedDiscount) * 100)
                    : null
                const hasAnyBanner =
                  defaultDiscountPct != null || businessDiscountPct > 0 || requestedDiscountPct != null
                const hasDiscount = requestedDiscountPct != null && requestedDiscountPct > 0

                return (
                  <div
                    key={item.id}
                    className={`bg-surface-elevated rounded-xl border overflow-hidden ${hasDiscount ? 'border-green-500/40' : 'border-border-default'}`}
                  >
                    {/* Discount tier banner */}
                    {hasAnyBanner && (
                      <div className="flex flex-wrap items-center gap-x-0 border-b border-border-default/60 text-[11px]">
                        {defaultDiscountPct != null && (
                          <div className="flex items-center gap-1.5 px-4 py-1.5 bg-surface-secondary border-l border-border-default/40 first:border-l-0">
                            <span className="text-foreground-muted">Default:</span>
                            <span className="font-semibold text-foreground-secondary">
                              {defaultDiscountPct}% off MRP
                            </span>
                          </div>
                        )}
                        {businessDiscountPct > 0 && (
                          <div className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-500/10 border-l border-border-default/40 first:border-l-0">
                            <span className="text-foreground-muted">Business:</span>
                            <span className="font-semibold text-blue-700 dark:text-blue-400">
                              {businessDiscountPct}% off customer price
                            </span>
                          </div>
                        )}
                        {requestedDiscountPct != null && requestedDiscountPct > 0 && (
                          <div className="flex items-center gap-1.5 px-4 py-1.5 bg-green-500/10 border-l border-border-default/40 first:border-l-0">
                            <span className="text-foreground-muted">Requested:</span>
                            <span className="font-semibold text-green-700 dark:text-green-400">
                              {requestedDiscountPct}% off {businessPrice != null ? 'business price' : 'customer price'}
                            </span>
                          </div>
                        )}
                        {requestedDiscountPct != null && requestedDiscountPct <= 0 && requestedInclGst != null && (
                          <div className="flex items-center gap-1.5 px-4 py-1.5 bg-amber-500/10 border-l border-border-default/40 first:border-l-0">
                            <span className="text-foreground-muted">Requested:</span>
                            <span className="font-semibold text-amber-700 dark:text-amber-400">
                              At/above {businessPrice != null ? 'business' : 'customer'} price
                            </span>
                          </div>
                        )}
                        {(() => {
                          // Effective price = min(requested, business, customer); anchor = MRP
                          const effectivePrice =
                            requestedInclGst != null
                              ? businessPrice != null && businessPrice < requestedInclGst
                                ? businessPrice
                                : requestedInclGst
                              : (businessPrice ?? sellingPrice ?? null)
                          if (mrpPrice != null && mrpPrice > 0 && effectivePrice != null && effectivePrice < mrpPrice) {
                            const effPct = Math.round(((mrpPrice - effectivePrice) / mrpPrice) * 100)
                            return (
                              <div className="w-full md:w-auto md:ml-auto flex items-center gap-1.5 px-4 py-1.5 bg-accent-500/10 border-l border-border-default/40 first:border-l-0">
                                <span className="text-foreground-muted">Effective:</span>
                                <span className="font-semibold text-accent-500">{effPct}% off MRP</span>
                              </div>
                            )
                          }
                          return null
                        })()}
                      </div>
                    )}

                    <div className="flex gap-0">
                      {/* Position number */}
                      <div className="flex items-center justify-center w-6 md:w-10 shrink-0 bg-surface-secondary border-r border-border-default">
                        <span className="text-xs font-mono text-foreground-muted">{i + 1}</span>
                      </div>

                      {/* Product image */}
                      <div className="w-14 h-14 md:w-20 md:h-20 shrink-0 bg-surface border-r border-border-default overflow-hidden self-stretch flex items-center justify-center">
                        {item.product_image_url ? (
                          <img
                            src={item.product_image_url}
                            alt={item.description}
                            className="w-full h-full object-contain p-1.5"
                          />
                        ) : (
                          <svg
                            className="w-8 h-8 text-foreground-muted"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={1}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                            />
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
                                {[item.product_name, item.variant_name, item.sub_variant_name]
                                  .filter(Boolean)
                                  .join(' — ')}
                              </p>
                            )}

                            {/* SKU + qty */}
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1.5">
                              {sku && (
                                <span className="text-[11px] font-mono text-foreground-muted bg-surface px-1.5 py-0.5 rounded border border-border-default inline-flex items-center gap-1">
                                  SKU: {sku}
                                  <CopySku sku={sku} />
                                </span>
                              )}
                              <span className="text-xs text-foreground-secondary">
                                Qty:{' '}
                                <span className="font-semibold text-foreground">
                                  {fmtQty(item.quantity)} {item.unit}
                                </span>
                              </span>
                            </div>

                            {/* Item notes */}
                            {item.notes && (
                              <p className="text-xs text-foreground-muted italic mt-1.5 border-l-2 border-accent-500/40 pl-2">
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
                                <p className="text-[10px] text-foreground-muted uppercase tracking-wide">
                                  Customer Price
                                </p>
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
                                <p className="text-sm font-medium text-blue-700 dark:text-blue-400">
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
                                <span className="text-foreground font-medium">₹{fmt2(itemSellingTotal)}</span>
                              </div>
                            )}
                            {itemRequestedTotal != null && (
                              <div className="text-xs text-foreground-muted">
                                Requested total:&nbsp;
                                <span className="font-semibold text-accent-500">₹{fmt2(itemRequestedTotal)}</span>
                              </div>
                            )}
                            {(() => {
                              // Effective total = min(requested, business price, customer price)
                              const businessItemTotal =
                                sellingPrice != null && businessDiscountPct > 0
                                  ? applyDiscount(sellingPrice, businessDiscountPct) * item.quantity
                                  : null
                              const effectiveTotal =
                                itemRequestedTotal != null
                                  ? businessItemTotal != null && businessItemTotal < itemRequestedTotal
                                    ? businessItemTotal
                                    : itemRequestedTotal
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
                  <p className="font-medium text-foreground-secondary line-through decoration-foreground-muted/50">
                    ₹{fmt2(totalMrp)}
                  </p>
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
                  <p className="font-semibold text-blue-700 dark:text-blue-400">₹{fmt2(totalBusinessPrice)}</p>
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
                  {totalSellingForDiscountedItems > totalBusinessPriceForRequestedItems &&
                    totalBusinessPriceForRequestedItems > 0 && (
                      <div className="text-right">
                        <p className="text-xs text-foreground-muted mb-0.5">Discount off Customer Price</p>
                        <p className="font-bold text-green-600 dark:text-green-400">
                          ₹{fmt2(totalSellingForDiscountedItems - totalBusinessPriceForRequestedItems)}
                          <span className="text-xs font-normal text-foreground-muted ml-1">
                            (
                            {Math.round(
                              ((totalSellingForDiscountedItems - totalBusinessPriceForRequestedItems) /
                                totalSellingForDiscountedItems) *
                                100
                            )}
                            %)
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
                          (
                          {Math.round(
                            ((totalSellingForDiscountedItems - totalRequested) / totalSellingForDiscountedItems) * 100
                          )}
                          %)
                        </span>
                      </p>
                    </div>
                  )}
                  {totalBusinessPriceForRequestedItems > 0 &&
                    totalBusinessPriceForRequestedItems !== totalSellingForDiscountedItems &&
                    totalBusinessPriceForRequestedItems > totalRequested && (
                      <div className="text-right">
                        <p className="text-xs text-foreground-muted mb-0.5">Discount off Business Price</p>
                        <p className="font-bold text-blue-700 dark:text-blue-400">
                          ₹{fmt2(totalBusinessPriceForRequestedItems - totalRequested)}
                          <span className="text-xs font-normal text-foreground-muted ml-1">
                            (
                            {Math.round(
                              ((totalBusinessPriceForRequestedItems - totalRequested) /
                                totalBusinessPriceForRequestedItems) *
                                100
                            )}
                            %)
                          </span>
                        </p>
                      </div>
                    )}
                </div>
              )}
            </div>
          )}
        </>
      }
      aside={
        <>
          <Card title="From">
            <Fields cols={1}>
              <Field label="Company" value={rfq.company_name} />
              <Field label="Contact" value={`${rfq.first_name} ${rfq.last_name || ''}`.trim()} />
              <Field label="Email" value={rfq.email} />
              <Field label="Phone" value={rfq.phone ? `+91 ${rfq.phone}` : null} />
              <Field label="GST" value={rfq.gst_number} mono copy={rfq.gst_number || undefined} />
            </Fields>
            <div className="mt-4 border-t border-border-default pt-4">
              <Link href={ap(`/admin/business/customers/${rfq.user_id}/view`)} className="text-xs font-medium text-accent-500 hover:text-accent-600">
                View customer profile
              </Link>
            </div>
          </Card>

          {rfq.notes && (
            <Card title="Customer note">
              <p className="whitespace-pre-line text-sm text-foreground">{rfq.notes}</p>
            </Card>
          )}

          {rfq.admin_note && (
            <Card title="Admin note">
              <p className="whitespace-pre-line text-sm text-foreground">{rfq.admin_note}</p>
            </Card>
          )}

          {rfq.status === 'converted' && rfq.converted_quotation_id && (
            <div className="space-y-3 rounded-xl border border-green-500/40 bg-green-500/5 p-4">
              <div>
                <p className="mb-1 text-sm font-medium text-green-700 dark:text-green-400">Converted to quotation</p>
                <Link href={ap(`/admin/quotations/${rfq.converted_quotation_id}/view`)} className="text-sm font-semibold text-accent-500 hover:underline">
                  Open Quotation {rfq.quote_number ? `(${rfq.quote_number})` : ''}
                </Link>
              </div>
              {rfq.order_id && (
                <div className="border-t border-green-500/30 pt-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-green-700 dark:text-green-400">Invoice raised</p>
                    {rfq.order_status === 'draft' && <span className={badgeCls('amber')}>Draft</span>}
                    {rfq.invoice_payment_status && rfq.order_status !== 'draft' && (
                      <span className={badgeCls(rfq.invoice_payment_status === 'paid' ? 'green' : 'amber')}>
                        {rfq.invoice_payment_status === 'paid' ? 'Paid' : rfq.invoice_payment_status === 'partial' ? 'Partially paid' : 'Unpaid'}
                      </span>
                    )}
                  </div>
                  {rfq.invoice_total && (
                    <p className="mb-1.5 text-xs text-foreground-muted">
                      Total: <span className="font-semibold text-foreground">₹{Number(rfq.invoice_total).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                    </p>
                  )}
                  <Link href={ap(`/admin/invoices/${rfq.order_id}/view`)} className="text-sm font-semibold text-accent-500 hover:underline">
                    Open Invoice {rfq.invoice_number ? `(${rfq.invoice_number})` : ''}
                  </Link>
                </div>
              )}
            </div>
          )}

          {/* Negotiation thread */}
          {!['converted', 'rejected', 'offer_accepted'].includes(rfq.status) || messages.length > 0 ? (
            <Card title="Negotiation thread" hint={messages.length > 0 ? `${messages.length} message${messages.length !== 1 ? 's' : ''}` : undefined} flush>

              {/* Message thread */}
              <div ref={threadRef} className="max-h-80 space-y-3 overflow-y-auto border-t border-border-default p-4">
                {messages.length === 0 ? (
                  <p className="text-xs text-foreground-muted text-center py-4">
                    No messages yet. Start the negotiation below.
                  </p>
                ) : (
                  messages.map(msg => {
                    const isAdmin = msg.sender === 'admin'
                    return (
                      <div key={msg.id} className={`flex flex-col gap-1 ${isAdmin ? 'items-end' : 'items-start'}`}>
                        <div className={`flex items-end gap-2 ${isAdmin ? 'flex-row-reverse' : ''}`}>
                          {/* Avatar */}
                          <div
                            className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${isAdmin ? 'bg-accent-500 text-white' : 'bg-surface-secondary text-foreground-secondary'}`}
                          >
                            {isAdmin ? 'A' : 'C'}
                          </div>
                          {/* Bubble */}
                          <div
                            className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${isAdmin ? 'bg-accent-500/10 border border-accent-500/30 text-foreground rounded-br-sm' : 'bg-surface border border-border-default text-foreground rounded-bl-sm'}`}
                          >
                            {msg.message}
                          </div>
                        </div>
                        {/* Counter items card */}
                        {msg.counter_items && msg.counter_items.length > 0 && (
                          <div className="mr-8 w-full max-w-[85%] space-y-1 rounded-xl border border-blue-500/30 bg-blue-500/10 p-3">
                            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-400">
                              Counter Prices
                            </p>
                            {msg.counter_items.map(ci => {
                              const item = items.find(it => it.id === ci.rfq_item_id)
                              return (
                                <div key={ci.rfq_item_id} className="flex items-center justify-between gap-2 text-xs">
                                  <span className="text-foreground-secondary truncate">
                                    {item?.description || ci.rfq_item_id}
                                  </span>
                                  <span className="shrink-0 font-semibold tabular-nums text-blue-700 dark:text-blue-400">
                                    ₹{fmt2(Number(ci.offered_price))}/unit
                                  </span>
                                </div>
                              )
                            })}
                          </div>
                        )}
                        <span className="text-[10px] text-foreground-muted px-8">{fmtTime(msg.created_at)}</span>
                      </div>
                    )
                  })
                )}
              </div>

              {/* Reply composer — hidden once customer has accepted */}
              {!['converted', 'rejected', 'offer_accepted'].includes(rfq.status) && (
                <RequireWrite scope="business_rfqs:write">
                  {['pending', 'reviewed'].includes(rfq.status) ? (
                    /* Quick-send chips for early stages: structured actions only */
                    <div className="space-y-4 border-t border-border-default p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">Quick Replies</p>
                      {presetChips([
                        "We've received your request and are reviewing it.",
                        'Could you please provide more details about your requirements?',
                        "We're preparing a counter offer for you shortly.",
                        "We can accommodate this request. We'll send pricing soon.",
                        "Thank you for your inquiry. We'll get back to you by end of day.",
                      ])}
                      {counterToggle('Make an offer — attach counter prices')}
                      {showCounterForm && counterPrices}
                      {sendButton('Send')}
                    </div>
                  ) : (
                    /* Full composer for negotiating state */
                    <div className="space-y-3 border-t border-border-default p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">Quick Replies</p>
                      {presetChips([
                        "Thanks for the counter. We're reviewing it and will respond shortly.",
                        "We've adjusted our pricing — please review the latest counter offer.",
                        "That's the best price we can offer for this quantity.",
                        'Could you increase the quantity? It will help us offer a better price.',
                        'We can match this price. Shall we proceed to a final quotation?',
                      ])}
                      <TextArea
                        value={replyText}
                        onChange={e => setReplyText(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            handleSendReply()
                          }
                        }}
                        placeholder="Type a reply… (Enter to send, Shift+Enter for new line)"
                        rows={3}
                        className="resize-none"
                      />
                      {counterToggle('Attach counter prices (optional)')}
                      {showCounterForm && counterPrices}
                      {sendButton('Send Reply')}
                    </div>
                  )}
                </RequireWrite>
              )}
            </Card>
          ) : null}
        </>
      }
      />
    </>
  )
}
