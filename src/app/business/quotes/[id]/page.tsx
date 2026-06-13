'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { bp } from '@/lib/business-path'
import { applyDiscount } from '@/lib/pricing'
import { BusinessAccountNavBar } from '@/components/business/AccountSidebar'
import BusinessAccountMobileHeader from '@/components/business/AccountMobileHeader'

interface RFQItem {
  id: string
  description: string
  quantity: number
  unit: string
  requested_price: number | null
  notes: string | null
  product_id: string | null
  variant_id: string | null
  product_slug: string | null
  category_id: string | null
  catalog_price: number | null
  catalog_mrp: number | null
  variant_price: number | null
  variant_mrp: number | null
  variant_sku: string | null
  image_url: string | null
  quoted_rate: number | null
  quoted_discount_pct: number | null
  quoted_gst_rate: number | null
}

interface RFQItemEdit {
  id: string
  quantity: number | ''
  requested_price: number | '' | null
  notes: string
}

interface RFQ {
  id: string
  rfq_number: string
  status: string
  notes: string | null
  admin_note: string | null
  created_at: string
  converted_quotation_id: string | null
  quotation_view_token: string | null
  quote_number: string | null
  converted_order_id: string | null
}

interface LinkedOrder {
  id: string
  order_number: string
  payment_status: string
  payment_mode: string | null
  razorpay_qr_image_url: string | null
  total_amount: number
  invoice_number: string | null
  status: string
  view_token: string | null
}

interface RFQMessage {
  id: string
  sender: 'customer' | 'admin'
  message: string
  counter_items: { rfq_item_id: string; offered_price: number }[] | null
  created_at: string
}

const STATUS_STYLES: Record<string, string> = {
  pending:        'bg-yellow-400/20 text-yellow-600 dark:text-yellow-300',
  reviewed:       'bg-blue-400/20 text-blue-600 dark:text-blue-300',
  negotiating:    'bg-purple-400/20 text-purple-600 dark:text-purple-300',
  offer_accepted: 'bg-teal-400/20 text-teal-600 dark:text-teal-300',
  converted:      'bg-green-400/20 text-green-600 dark:text-green-300',
  rejected:       'bg-red-400/20 text-red-600 dark:text-red-300',
}

const STATUS_LABEL: Record<string, string> = {
  pending:        'Pending Review',
  reviewed:       'Under Review',
  negotiating:    'Negotiating',
  offer_accepted: 'Offer Accepted',
  converted:      'Quotation Ready',
  rejected:       'Rejected',
}

const EDITABLE_STATUSES = ['pending', 'reviewed', 'negotiating']

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  })
}

export default function BusinessRFQDetail({ params }: { params: { id: string } }) {
  const [rfq, setRfq] = useState<RFQ | null>(null)
  const [items, setItems] = useState<RFQItem[]>([])
  const [linkedOrder, setLinkedOrder] = useState<LinkedOrder | null>(null)
  const [messages, setMessages] = useState<RFQMessage[]>([])
  const [discountMap, setDiscountMap] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  // Edit state
  const [editing, setEditing] = useState(false)
  const [editItems, setEditItems] = useState<RFQItemEdit[]>([])
  const [editNotes, setEditNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saved, setSaved] = useState(false)

  // Message state
  const [msgText, setMsgText] = useState('')
  const [sendingMsg, setSendingMsg] = useState(false)
  const [msgError, setMsgError] = useState('')
  const [respondingAction, setRespondingAction] = useState<'accept' | 'decline' | null>(null)
  const [counterReplyText, setCounterReplyText] = useState('')
  const [showCounterInput, setShowCounterInput] = useState(false)
  const [counterPrices, setCounterPrices] = useState<Record<string, string>>({})
  const [resubmitting, setResubmitting] = useState(false)
  const [resubmitNotes, setResubmitNotes] = useState('')
  const [resubmitError, setResubmitError] = useState('')
  const threadRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  const load = () => {
    setLoading(true)
    fetch(`/api/business/rfqs/${params.id}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        setRfq(d.rfq || null)
        setItems(d.items || [])
        setLinkedOrder(d.order || null)
        setDiscountMap(d.discountMap || {})
        setLoading(false)
      })
      .catch(() => setLoading(false))

    fetch(`/api/business/rfqs/${params.id}/messages`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : { messages: [] })
      .then(m => setMessages(m.messages || []))
      .catch(() => {/* messages table may not exist yet */})
  }

  useEffect(() => { load() }, [params.id])

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight
    }
  }, [messages])

  const startEdit = () => {
    setEditItems(items.map(item => ({
      id: item.id,
      quantity: item.quantity,
      requested_price: item.requested_price,
      notes: item.notes || '',
    })))
    setEditNotes(rfq?.notes || '')
    setSaveError('')
    setSaved(false)
    setEditing(true)
  }

  const cancelEdit = () => { setEditing(false); setSaveError('') }

  const handleSave = async () => {
    setSaving(true)
    setSaveError('')
    try {
      const res = await fetch(`/api/business/rfqs/${params.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes: editNotes || null,
          items: editItems.map(item => ({
            id: item.id,
            quantity: item.quantity === '' ? null : Number(item.quantity),
            requested_price: item.requested_price === '' || item.requested_price == null ? null : Number(item.requested_price),
            notes: item.notes || null,
          })),
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        setSaveError(d.error || 'Failed to save')
        return
      }
      setSaved(true)
      setEditing(false)
      load()
    } catch {
      setSaveError('Network error, please try again')
    } finally {
      setSaving(false)
    }
  }

  const handleSendMessage = async () => {
    if (!msgText.trim()) return
    setSendingMsg(true)
    setMsgError('')
    try {
      const res = await fetch(`/api/business/rfqs/${params.id}/messages`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msgText.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setMsgError(data.error || 'Failed to send'); return }
      setMessages(prev => [...prev, data.message])
      setMsgText('')
      if (rfq && ['pending', 'reviewed'].includes(rfq.status)) {
        setRfq(r => r ? { ...r, status: 'negotiating' } : r)
      }
    } catch {
      setMsgError('Network error')
    } finally {
      setSendingMsg(false)
    }
  }

  const handleRespond = async (action: 'accept' | 'decline') => {
    setRespondingAction(action)
    setMsgError('')
    try {
      const message = action === 'decline' ? counterReplyText.trim() || undefined : undefined
      const counter_items = action === 'decline'
        ? Object.entries(counterPrices)
            .map(([rfq_item_id, raw]) => ({ rfq_item_id, offered_price: Number(raw) }))
            .filter(c => Number.isFinite(c.offered_price) && c.offered_price >= 0)
        : undefined
      const payload: { action: string; message?: string; counter_items?: typeof counter_items } = { action, message }
      if (counter_items && counter_items.length > 0) payload.counter_items = counter_items
      const res = await fetch(`/api/business/rfqs/${params.id}/respond`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) { setMsgError(data.error || 'Failed to respond'); return }
      setShowCounterInput(false)
      setCounterReplyText('')
      setCounterPrices({})
      load()
    } catch {
      setMsgError('Network error')
    } finally {
      setRespondingAction(null)
    }
  }

  const handleResubmit = async () => {
    setResubmitError('')
    setResubmitting(true)
    try {
      const res = await fetch(`/api/business/rfqs/${params.id}/resubmit`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: resubmitNotes.trim() || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setResubmitError(data?.error || 'Failed to resubmit')
        return
      }
      const newId = data?.rfq?.id
      if (newId) {
        router.push(bp(`/business/quotes/${newId}`))
      }
    } catch (e: any) {
      setResubmitError(e?.message || 'Network error')
    } finally {
      setResubmitting(false)
    }
  }

  if (loading) return (
    <div className="bg-surface min-h-screen flex items-center justify-center">
      <div className="animate-spin w-8 h-8 border-4 border-accent-500 border-t-transparent rounded-full" />
    </div>
  )

  if (!rfq) return (
    <div className="bg-surface min-h-screen flex items-center justify-center text-foreground-muted">
      Quote not found.
    </div>
  )

  const canEdit = EDITABLE_STATUSES.includes(rfq.status)
  const canMessage = !['converted', 'rejected', 'offer_accepted'].includes(rfq.status)
  const totalRequested = items.reduce((sum, i) => sum + (i.requested_price ? Number(i.requested_price) * i.quantity : 0), 0)

  const latestCounter = [...messages].reverse().find(m => m.sender === 'admin' && m.counter_items?.length)
  const counterMap: Record<string, number> = {}
  if (latestCounter?.counter_items) {
    for (const ci of latestCounter.counter_items) {
      counterMap[ci.rfq_item_id] = ci.offered_price
    }
  }

  return (
    <div className="bg-surface min-h-screen">
      <BusinessAccountNavBar />
      <BusinessAccountMobileHeader />
      <div className="container mx-auto px-4 py-6 pb-32">

        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-foreground-secondary mb-5">
          <Link href={bp('/business/quotes')} className="text-accent-500 hover:text-accent-600 transition-colors">My Quotes</Link>
          <span>/</span>
          <span className="text-foreground font-mono">{rfq.rfq_number}</span>
        </div>

        {/* Header card — full width */}
        <div className="bg-zinc-800 rounded-2xl p-5 text-white border border-zinc-700 mb-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold font-mono">{rfq.rfq_number}</h1>
                <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${STATUS_STYLES[rfq.status] || 'bg-zinc-500/20 text-zinc-300'}`}>
                  {STATUS_LABEL[rfq.status] || rfq.status}
                </span>
              </div>
              <p className="text-zinc-400 text-xs mt-1">
                Submitted {new Date(rfq.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {rfq.status === 'converted' && rfq.quotation_view_token && (
                <a
                  href={`https://quotation.jeffistores.in/${rfq.quotation_view_token}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 border border-accent-500 text-accent-400 text-sm font-semibold rounded-lg hover:bg-accent-900/20 transition-colors shrink-0"
                >
                  View Quotation →
                </a>
              )}
            </div>
          </div>
          {rfq.admin_note && (
            <div className={`mt-4 rounded-lg p-3 text-sm ${rfq.status === 'rejected' ? 'bg-red-900/30 border border-red-800 text-red-300' : 'bg-blue-900/30 border border-blue-800 text-blue-300'}`}>
              <p className="font-semibold mb-1">{rfq.status === 'rejected' ? 'Reason for rejection:' : 'Note from our team:'}</p>
              <p className="font-normal">{rfq.admin_note}</p>
            </div>
          )}

          {rfq.status === 'rejected' && (
            <div className="mt-4 rounded-lg border border-amber-800 bg-amber-900/20 p-4 text-sm">
              <p className="font-semibold text-amber-200 mb-1">Need to revise and try again?</p>
              <p className="text-amber-300/90 mb-3">
                You can submit a new quote request with the same items. Our team will review it as a fresh ticket.
              </p>
              <textarea
                value={resubmitNotes}
                onChange={e => setResubmitNotes(e.target.value)}
                rows={2}
                placeholder="Optional: any updated context or reason for the resubmission..."
                className="w-full px-3 py-2 rounded-lg border border-amber-700 bg-amber-950/40 text-amber-100 placeholder:text-amber-400/70 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 mb-3"
              />
              {resubmitError && (
                <p className="text-xs text-red-300 mb-2">{resubmitError}</p>
              )}
              <button
                onClick={handleResubmit}
                disabled={resubmitting}
                className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-zinc-900 text-sm font-semibold transition-colors disabled:opacity-60"
              >
                {resubmitting ? 'Submitting…' : 'Request New Quote'}
              </button>
            </div>
          )}
        </div>

        {/* Save success banner */}
        {saved && (
          <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-xl p-3 text-sm text-green-700 dark:text-green-300 flex items-center gap-2 mb-5">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Changes saved successfully.
          </div>
        )}

        {/* Two-column grid on large screens */}
        <div className="lg:grid lg:grid-cols-3 lg:gap-6 space-y-5 lg:space-y-0">

          {/* LEFT — Items + Messages */}
          <div className="lg:col-span-2 space-y-5">

            {/* Items table */}
            <div className="bg-surface-elevated border border-border-default rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-border-default flex items-center justify-between">
                <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">Requested Items</h2>
                {canEdit && !editing && (
                  <button
                    onClick={startEdit}
                    className="text-xs text-accent-600 hover:text-accent-700 dark:text-accent-400 font-medium px-3 py-1 rounded-lg border border-accent-200 dark:border-accent-800 transition-colors"
                  >
                    Edit Request
                  </button>
                )}
              </div>

              {!editing ? (
                <div className="divide-y divide-border-default">
                  {items.map((item, i) => {
                    const offered = counterMap[item.id]
                    const catalogUnit = item.variant_price ?? item.catalog_price
                    const discountPct = item.category_id ? (discountMap[item.category_id] ?? 0) : 0
                    const businessUnitPrice = catalogUnit && discountPct > 0 ? applyDiscount(catalogUnit, discountPct) : null
                    const shownCatalogPrice = businessUnitPrice ?? catalogUnit
                    const catalogMrp = item.variant_mrp ?? item.catalog_mrp

                    // "Offered" = quoted_rate (finalized quotation, ex-GST → convert back to incl-GST) or counter offer from messages (already incl-GST)
                    const quotedGstRate = item.quoted_gst_rate != null ? Number(item.quoted_gst_rate) : 18
                    const offeredPrice = item.quoted_rate != null
                      ? Number(item.quoted_rate) * (1 + quotedGstRate / 100)
                      : offered != null ? Number(offered) : null
                    const offeredDiscountSource = item.quoted_rate != null ? item.quoted_discount_pct : null

                    // requested discount % vs our business price
                    const reqDiscountPct = item.requested_price != null && shownCatalogPrice && shownCatalogPrice > 0
                      ? Math.round((1 - Number(item.requested_price) / Number(shownCatalogPrice)) * 100)
                      : null
                    // offered discount % vs our business price
                    const offeredDiscountPct = offeredDiscountSource != null
                      ? Number(offeredDiscountSource)
                      : offeredPrice != null && shownCatalogPrice && shownCatalogPrice > 0
                        ? Math.round((1 - offeredPrice / Number(shownCatalogPrice)) * 100)
                        : null

                    const hasOffer = offeredPrice != null

                    return (
                      <div key={item.id} className={`px-4 py-4 sm:px-5 ${hasOffer ? 'bg-purple-50/40 dark:bg-purple-900/10' : ''}`}>
                        {/* Top row: image + name + qty badge */}
                        <div className="flex gap-3 mb-3">
                          {/* Image */}
                          <div className="w-14 h-14 flex-shrink-0 rounded-xl border border-border-default bg-surface-secondary overflow-hidden">
                            {item.image_url ? (
                              <img src={item.image_url} alt={item.description} className="w-full h-full object-contain p-1" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <svg className="w-5 h-5 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                              </div>
                            )}
                          </div>

                          {/* Name + meta */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <p className="font-semibold text-foreground text-sm leading-snug">
                                {item.product_slug ? (
                                  <Link href={bp(`/business/products/${item.product_slug}`)} className="hover:text-accent-500 transition-colors">
                                    {item.description}
                                  </Link>
                                ) : item.description}
                              </p>
                              {/* Item index */}
                              <span className="text-[11px] text-foreground-muted font-mono flex-shrink-0">#{i + 1}</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 mt-1">
                              {item.variant_sku && (
                                <span className="text-[11px] text-foreground-muted bg-surface-secondary px-1.5 py-0.5 rounded font-mono">
                                  {item.variant_sku}
                                </span>
                              )}
                              {/* Qty badge */}
                              <span className="text-[11px] font-semibold text-foreground-secondary bg-surface-secondary px-2 py-0.5 rounded-full">
                                {item.quantity} {item.unit}
                              </span>
                              {/* Offer badge */}
                              {hasOffer && (
                                <span className="text-[11px] font-semibold text-purple-600 dark:text-purple-400 bg-purple-100 dark:bg-purple-900/30 px-2 py-0.5 rounded-full">
                                  Offer received
                                </span>
                              )}
                            </div>
                            {item.notes && <p className="text-xs text-foreground-muted italic mt-0.5">{item.notes}</p>}
                          </div>
                        </div>

                        {/* Price grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1">
                          {/* Our Price */}
                          {shownCatalogPrice != null && (
                            <div className="bg-surface-secondary rounded-xl px-3 py-2.5">
                              <p className="text-[10px] font-semibold text-foreground-muted uppercase tracking-wide mb-1">Our Price</p>
                              <p className="text-sm font-bold text-foreground leading-none">
                                ₹{Number(shownCatalogPrice).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </p>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {/* MRP strikethrough */}
                                {businessUnitPrice && catalogUnit && (
                                  <span className="text-[10px] text-foreground-muted line-through">
                                    ₹{Number(catalogUnit).toLocaleString('en-IN', { minimumFractionDigits: 0 })}
                                  </span>
                                )}
                                {!businessUnitPrice && catalogMrp && catalogMrp > Number(catalogUnit ?? 0) && (
                                  <span className="text-[10px] text-foreground-muted line-through">
                                    MRP ₹{Number(catalogMrp).toLocaleString('en-IN', { minimumFractionDigits: 0 })}
                                  </span>
                                )}
                                {discountPct > 0 && (
                                  <span className="text-[10px] font-bold text-green-600 dark:text-green-400">
                                    {discountPct}% off
                                  </span>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Your Target */}
                          <div className={`rounded-xl px-3 py-2.5 ${item.requested_price != null ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800' : 'bg-surface-secondary'}`}>
                            <p className="text-[10px] font-semibold text-foreground-muted uppercase tracking-wide mb-1">Your Target</p>
                            {item.requested_price != null ? (
                              <>
                                <p className="text-sm font-bold text-amber-700 dark:text-amber-400 leading-none">
                                  ₹{Number(item.requested_price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                </p>
                                {reqDiscountPct != null && reqDiscountPct > 0 && (
                                  <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-500 mt-1">
                                    {reqDiscountPct}% discount
                                  </p>
                                )}
                              </>
                            ) : (
                              <p className="text-sm text-foreground-muted leading-none">—</p>
                            )}
                          </div>

                          {/* Offered Price */}
                          <div className={`rounded-xl px-3 py-2.5 ${hasOffer ? 'bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800' : 'bg-surface-secondary'}`}>
                            <p className="text-[10px] font-semibold text-foreground-muted uppercase tracking-wide mb-1">
                              {item.quoted_rate != null ? 'Quoted Price' : 'Offered'}
                            </p>
                            {hasOffer ? (
                              <>
                                <p className="text-sm font-bold text-purple-700 dark:text-purple-300 leading-none">
                                  ₹{Number(offeredPrice).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                </p>
                                {offeredDiscountPct != null && offeredDiscountPct > 0 && (
                                  <p className="text-[10px] font-semibold text-purple-600 dark:text-purple-400 mt-1">
                                    {offeredDiscountPct}% off
                                  </p>
                                )}
                              </>
                            ) : (
                              <p className="text-sm text-foreground-muted leading-none">—</p>
                            )}
                          </div>

                          {/* Line Total */}
                          <div className="bg-surface-secondary rounded-xl px-3 py-2.5">
                            <p className="text-[10px] font-semibold text-foreground-muted uppercase tracking-wide mb-1">Line Total</p>
                            {shownCatalogPrice != null ? (
                              <p className="text-sm font-bold text-foreground leading-none">
                                ₹{(Number(shownCatalogPrice) * item.quantity).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                              </p>
                            ) : (
                              <p className="text-sm text-foreground-muted leading-none">—</p>
                            )}
                            {item.requested_price != null && (
                              <p className="text-[10px] text-foreground-muted mt-1">
                                Target: ₹{(Number(item.requested_price) * item.quantity).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}

                  {/* Summary footer */}
                  {totalRequested > 0 && (
                    <div className="px-5 py-3 bg-surface-secondary/40 flex items-center justify-between">
                      <span className="text-sm font-semibold text-foreground-secondary">Total Target Value</span>
                      <span className="font-bold text-foreground">₹{totalRequested.toLocaleString('en-IN')}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-border-default">
                  {editItems.map((item, i) => {
                    const orig = items[i]
                    return (
                      <div key={item.id} className="p-5 space-y-3">
                        <div className="flex items-start gap-3">
                          <span className="text-xs text-foreground-muted font-mono mt-0.5 w-4 flex-shrink-0">{i + 1}</span>
                          <p className="font-medium text-foreground text-sm">{orig.description}</p>
                        </div>
                        <div className="pl-7 grid grid-cols-2 gap-3 sm:grid-cols-3">
                          <div>
                            <label className="block text-xs font-medium text-foreground-muted mb-1">Quantity <span className="text-foreground-secondary">({orig.unit})</span></label>
                            <input
                              type="number"
                              min={1}
                              value={item.quantity}
                              onChange={e => setEditItems(prev => prev.map((it, idx) => idx === i ? { ...it, quantity: e.target.value === '' ? '' : Number(e.target.value) } : it))}
                              className="w-full px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground text-sm focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-foreground-muted mb-1">Target Price (₹)</label>
                            <input
                              type="number"
                              min={0}
                              step={0.01}
                              placeholder="Optional"
                              value={item.requested_price ?? ''}
                              onChange={e => setEditItems(prev => prev.map((it, idx) => idx === i ? { ...it, requested_price: e.target.value === '' ? null : Number(e.target.value) } : it))}
                              className="w-full px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground text-sm focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
                            />
                            <p className="text-[11px] text-foreground-muted mt-1">Max 30% discount off listed price</p>
                          </div>
                          <div className="col-span-2 sm:col-span-1">
                            <label className="block text-xs font-medium text-foreground-muted mb-1">Item Notes</label>
                            <input
                              type="text"
                              placeholder="Optional"
                              value={item.notes}
                              onChange={e => setEditItems(prev => prev.map((it, idx) => idx === i ? { ...it, notes: e.target.value } : it))}
                              className="w-full px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground text-sm focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
                            />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Negotiation thread */}
            {!editing && (messages.length > 0 || canMessage || rfq.status === 'offer_accepted') && (
              <div className="bg-surface-elevated border border-border-default rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-border-default">
                  <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">Messages</h2>
                </div>

                {messages.length > 0 && (
                  <div ref={threadRef} className="p-4 space-y-3 max-h-96 overflow-y-auto">
                    {messages.map(msg => {
                      const isAdmin = msg.sender === 'admin'
                      return (
                        <div key={msg.id} className={`flex gap-2 ${isAdmin ? '' : 'flex-row-reverse'}`}>
                          <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold ${isAdmin ? 'bg-accent-500 text-white' : 'bg-zinc-600 text-white'}`}>
                            {isAdmin ? 'JS' : 'Me'}
                          </div>

                          <div className={`flex-1 max-w-[80%] space-y-1.5 ${isAdmin ? '' : 'items-end flex flex-col'}`}>
                            <div className={`rounded-2xl px-4 py-2.5 text-sm ${isAdmin ? 'bg-surface rounded-tl-none border border-border-default' : 'bg-accent-500 text-white rounded-tr-none'}`}>
                              <p className="whitespace-pre-wrap leading-relaxed">{msg.message}</p>
                            </div>

                            {isAdmin && msg.counter_items && msg.counter_items.length > 0 && (
                              <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-xl p-3 space-y-1.5 w-full">
                                <p className="text-[11px] font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wide">Offered Prices</p>
                                {msg.counter_items.map(ci => {
                                  const item = items.find(it => it.id === ci.rfq_item_id)
                                  return (
                                    <div key={ci.rfq_item_id} className="flex items-center justify-between gap-3 text-xs">
                                      <span className="text-foreground-secondary truncate">{item?.description || ci.rfq_item_id}</span>
                                      <span className="font-semibold text-purple-600 dark:text-purple-400 shrink-0">
                                        ₹{Number(ci.offered_price).toLocaleString('en-IN')}
                                      </span>
                                    </div>
                                  )
                                })}
                              </div>
                            )}

                            <p className="text-[11px] text-foreground-muted px-1">{fmtTime(msg.created_at)}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {messages.length === 0 && !rfq.status.includes('offer_accepted') && (
                  <div className="px-5 py-6 text-center text-sm text-foreground-muted">
                    No messages yet.
                  </div>
                )}

                {/* Offer accepted state */}
                {rfq.status === 'offer_accepted' && (
                  <div className="px-4 pb-4 pt-3">
                    <div className="flex items-center gap-3 rounded-xl bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-700 p-4">
                      <div className="w-9 h-9 rounded-full bg-teal-500 flex items-center justify-center shrink-0">
                        <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-teal-700 dark:text-teal-400">Offer accepted</p>
                        <p className="text-xs text-teal-600/80 dark:text-teal-500 mt-0.5">
                          Our team is preparing your quotation. You&apos;ll be notified once it&apos;s ready.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {canMessage && (
                  <div className="px-4 pb-4 pt-2 border-t border-border-default space-y-3">
                    {msgError && <p className="text-xs text-red-500">{msgError}</p>}

                    {/* Counter offer action card — shown when last admin message has counter_items */}
                    {latestCounter ? (
                      <div className="rounded-xl border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-4 space-y-3">
                        <div className="flex items-center gap-2">
                          <svg className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                          </svg>
                          <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">You have a pending offer</p>
                        </div>

                        {/* Offered prices summary */}
                        <div className="space-y-1.5">
                          {latestCounter.counter_items!.map(ci => {
                            const item = items.find(it => it.id === ci.rfq_item_id)
                            const catalogUnit = item ? (item.variant_price ?? item.catalog_price) : null
                            const discountPct = item?.category_id ? (discountMap[item.category_id] ?? 0) : 0
                            const businessPrice = catalogUnit && discountPct > 0 ? applyDiscount(catalogUnit, discountPct) : catalogUnit
                            const savingPct = businessPrice && businessPrice > 0
                              ? Math.round((1 - ci.offered_price / Number(businessPrice)) * 100)
                              : null
                            return (
                              <div key={ci.rfq_item_id} className="flex items-center justify-between gap-3 bg-white dark:bg-zinc-800 rounded-lg px-3 py-2">
                                <span className="text-xs text-foreground-secondary truncate">{item?.description || 'Item'}</span>
                                <div className="flex items-center gap-2 shrink-0">
                                  {savingPct != null && savingPct > 0 && (
                                    <span className="text-[10px] font-semibold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 px-1.5 py-0.5 rounded-full">
                                      {savingPct}% off
                                    </span>
                                  )}
                                  <span className="text-sm font-bold text-foreground">
                                    ₹{Number(ci.offered_price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                  </span>
                                </div>
                              </div>
                            )
                          })}
                        </div>

                        {/* Action buttons */}
                        {!showCounterInput ? (
                          <div className="flex gap-2 pt-1">
                            <button
                              onClick={() => handleRespond('accept')}
                              disabled={respondingAction != null}
                              className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60"
                            >
                              {respondingAction === 'accept' ? (
                                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                              Accept Offer
                            </button>
                            <button
                              onClick={() => {
                                const seed: Record<string, string> = {}
                                for (const ci of latestCounter.counter_items || []) {
                                  seed[ci.rfq_item_id] = String(ci.offered_price)
                                }
                                setCounterPrices(seed)
                                setShowCounterInput(true)
                              }}
                              disabled={respondingAction != null}
                              className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 border border-border-secondary text-foreground-secondary hover:bg-surface-secondary text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                              </svg>
                              Negotiate / Counter
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-3 pt-1">
                            <div className="space-y-1.5">
                              <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Your counter prices</p>
                              {(latestCounter.counter_items || []).map(ci => {
                                const item = items.find(it => it.id === ci.rfq_item_id)
                                return (
                                  <div key={ci.rfq_item_id} className="flex items-center justify-between gap-3 bg-white dark:bg-zinc-800 rounded-lg px-3 py-2 border border-border-secondary">
                                    <div className="min-w-0 flex-1">
                                      <span className="text-xs text-foreground-secondary truncate block">{item?.description || 'Item'}</span>
                                      <span className="text-[10px] text-foreground-muted">Admin offered ₹{Number(ci.offered_price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <span className="text-xs text-foreground-secondary">₹</span>
                                      <input
                                        type="number"
                                        min={0}
                                        step="0.01"
                                        value={counterPrices[ci.rfq_item_id] ?? ''}
                                        onChange={e => setCounterPrices(p => ({ ...p, [ci.rfq_item_id]: e.target.value }))}
                                        className="w-24 px-2 py-1 border border-border-secondary rounded-md bg-surface text-foreground text-sm text-right focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
                                      />
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                            <textarea
                              rows={2}
                              autoFocus
                              value={counterReplyText}
                              onChange={e => setCounterReplyText(e.target.value)}
                              placeholder="Explain your counter offer or ask a question…"
                              className="w-full px-3 py-2 border border-border-secondary rounded-xl bg-surface text-foreground text-sm focus:ring-2 focus:ring-accent-500 focus:border-accent-500 resize-none"
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleRespond('decline')}
                                disabled={respondingAction != null}
                                className="flex-1 px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5"
                              >
                                {respondingAction === 'decline' ? (
                                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                ) : null}
                                Send Counter Offer
                              </button>
                              <button
                                onClick={() => { setShowCounterInput(false); setCounterReplyText(''); setCounterPrices({}) }}
                                disabled={respondingAction != null}
                                className="px-3 py-2 border border-border-secondary text-foreground-secondary hover:bg-surface-secondary text-sm rounded-lg transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-foreground-muted text-center py-2">
                        Awaiting a response from our team.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* RIGHT — Sidebar */}
          <div className="lg:col-span-1 space-y-4">

            {/* Notes */}
            {!editing ? (
              rfq.notes ? (
                <div className="bg-surface-elevated border border-border-default rounded-xl p-5">
                  <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-3">Your Notes</h2>
                  <p className="text-sm text-foreground">{rfq.notes}</p>
                </div>
              ) : null
            ) : (
              <div className="bg-surface-elevated border border-border-default rounded-xl p-5">
                <label className="block text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-3">Overall Notes</label>
                <textarea
                  rows={3}
                  placeholder="Any additional notes…"
                  value={editNotes}
                  onChange={e => setEditNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground text-sm focus:ring-2 focus:ring-accent-500 focus:border-accent-500 resize-none"
                />
              </div>
            )}

            {/* Linked order / payment info */}
            {linkedOrder && (
              <div className="bg-surface-elevated border border-border-default rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-border-default">
                  <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">Invoice / Order</p>
                  <p className="text-sm font-mono font-semibold text-foreground mt-0.5">
                    {linkedOrder.invoice_number || linkedOrder.order_number}
                  </p>
                </div>
                <div className="px-5 py-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-foreground-muted">Payment</span>
                    <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${linkedOrder.payment_status === 'paid' ? 'bg-green-400/20 text-green-600 dark:text-green-300' : 'bg-yellow-400/20 text-yellow-600 dark:text-yellow-300'}`}>
                      {linkedOrder.payment_status === 'paid' ? 'Paid' : 'Awaiting Payment'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-foreground-muted">Total</span>
                    <span className="text-sm font-bold text-foreground">
                      ₹{Number(linkedOrder.total_amount).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                  {linkedOrder.payment_status === 'paid' && (
                    <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p className="text-xs font-medium">Payment received. Thank you!</p>
                    </div>
                  )}
                  <Link
                    href={bp(`/business/account/orders/${linkedOrder.id}`)}
                    className="block w-full text-center text-xs text-accent-500 hover:text-accent-600 font-semibold px-3 py-2 rounded-lg border border-accent-200 dark:border-accent-800 transition-colors"
                  >
                    View Order →
                  </Link>
                  {linkedOrder.view_token && (
                    <a
                      href={`https://invoice.jeffistores.in/${linkedOrder.view_token}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-full text-center text-xs bg-accent-500 hover:bg-accent-600 text-white font-semibold px-3 py-2 rounded-lg transition-colors"
                    >
                      View Invoice →
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* Status timeline */}
            <div className="bg-surface-elevated border border-border-default rounded-xl p-5">
              <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-4">Status</h2>
              <ol className="relative border-l border-border-default space-y-4 ml-2">
                {(['pending', 'reviewed', 'negotiating', 'offer_accepted', 'converted'] as const).map((s) => {
                  const statuses = ['pending', 'reviewed', 'negotiating', 'offer_accepted', 'converted', 'rejected']
                  const currentIdx = statuses.indexOf(rfq.status)
                  const stepIdx = statuses.indexOf(s)
                  const done = rfq.status === 'rejected' ? false : currentIdx >= stepIdx
                  const active = rfq.status === s
                  return (
                    <li key={s} className="ml-4">
                      <span className={`absolute -left-1.5 w-3 h-3 rounded-full border-2 ${active ? 'border-accent-500 bg-accent-500' : done ? 'border-green-500 bg-green-500' : 'border-border-secondary bg-surface'}`} />
                      <p className={`text-xs font-medium ${active ? 'text-accent-500' : done ? 'text-green-600 dark:text-green-400' : 'text-foreground-muted'}`}>
                        {STATUS_LABEL[s]}
                      </p>
                    </li>
                  )
                })}
                {rfq.status === 'rejected' && (
                  <li className="ml-4">
                    <span className="absolute -left-1.5 w-3 h-3 rounded-full border-2 border-red-500 bg-red-500" />
                    <p className="text-xs font-medium text-red-600 dark:text-red-400">Rejected</p>
                  </li>
                )}
              </ol>
            </div>

          </div>
        </div>

        {/* Sticky save/cancel bar */}
        {editing && (
          <div className="fixed bottom-0 left-0 right-0 z-30 bg-surface-elevated border-t border-border-default px-4 py-3 flex items-center gap-3 shadow-lg">
            {saveError && <p className="text-xs text-red-600 dark:text-red-400 flex-1">{saveError}</p>}
            {!saveError && <span className="flex-1 text-xs text-foreground-muted">Review your changes before saving</span>}
            <button onClick={cancelEdit} disabled={saving}
              className="px-4 py-2 rounded-lg border border-border-secondary text-foreground-secondary text-sm font-medium hover:bg-surface-secondary transition-colors disabled:opacity-50">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              className="px-5 py-2 bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60 flex items-center gap-2">
              {saving && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
