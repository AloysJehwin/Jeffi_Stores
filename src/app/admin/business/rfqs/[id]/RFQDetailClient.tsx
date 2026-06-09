'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

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
  variant_name: string | null
  variant_sku: string | null
  variant_price: number | null
  sub_variant_name: string | null
  sub_variant_sku: string | null
  sub_variant_price: number | null
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
}

const STATUS_STYLES: Record<string, string> = {
  pending:   'bg-yellow-400/20 text-yellow-300',
  reviewed:  'bg-blue-400/20 text-blue-300',
  converted: 'bg-green-400/20 text-green-300',
  rejected:  'bg-red-400/20 text-red-300',
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending Review',
  reviewed: 'Reviewed',
  converted: 'Converted to Quotation',
  rejected: 'Rejected',
}

function resolveItemPrice(item: RFQItem): number | null {
  const raw = item.sub_variant_price ?? item.variant_price ?? item.base_price ?? null
  return raw != null ? Number(raw) : null
}

function resolveItemSku(item: RFQItem): string | null {
  return item.sub_variant_sku || item.variant_sku || item.product_sku || null
}

export default function RFQDetailClient({ id }: { id: string }) {
  const [rfq, setRfq] = useState<RFQ | null>(null)
  const [items, setItems] = useState<RFQItem[]>([])
  const [loading, setLoading] = useState(true)
  const [converting, setConverting] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [adminNote, setAdminNote] = useState('')
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  useEffect(() => {
    fetch(`/api/admin/business/rfqs/${id}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        setRfq(d.rfq)
        setItems(d.items || [])
        setAdminNote(d.rfq?.admin_note || '')
        setLoading(false)
      })
      .catch(() => setLoading(false))
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

  const totalRequested = items.reduce((sum, i) => sum + (i.requested_price ? Number(i.requested_price) * i.quantity : 0), 0)
  const totalCatalog = items.reduce((sum, i) => {
    const p = resolveItemPrice(i)
    return sum + (p != null ? p * i.quantity : 0)
  }, 0)

  if (loading) return (
    <div className="p-6 flex items-center justify-center py-24">
      <div className="animate-spin w-8 h-8 border-4 border-accent-500 border-t-transparent rounded-full" />
    </div>
  )

  if (!rfq) return <div className="p-6 text-center text-foreground-muted">RFQ not found.</div>

  return (
    <div className="p-4 sm:p-6 max-w-full space-y-5">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm font-medium text-white ${toast.type === 'error' ? 'bg-red-600' : 'bg-green-600'}`}>
          {toast.msg}
        </div>
      )}

      {confirmOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={() => setConfirmOpen(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="bg-surface-elevated border border-border-default rounded-2xl shadow-2xl w-full max-w-sm pointer-events-auto p-6 space-y-4">
              <h3 className="text-base font-semibold text-foreground">Convert to Quotation?</h3>
              <p className="text-sm text-foreground-secondary">A draft quotation will be created with the prices from this RFQ. You can edit the rates in the quotation before sending.</p>
              <div className="flex gap-3 pt-1">
                <button onClick={doConvert} disabled={converting}
                  className="flex-1 px-4 py-2.5 bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                  {converting && <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  Convert
                </button>
                <button onClick={() => setConfirmOpen(false)}
                  className="px-4 py-2.5 border border-border-default text-sm font-medium rounded-lg hover:bg-surface-secondary transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-foreground-secondary">
        <Link href="/admin/business/rfqs" className="text-accent-500 hover:text-accent-600 transition-colors">Business RFQs</Link>
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
              <>
                <button onClick={() => handleStatusChange('reviewed')} disabled={actionLoading}
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60">
                  Mark Reviewed
                </button>
                <button onClick={() => setShowRejectForm(s => !s)}
                  className="px-4 py-2 border border-red-400 text-red-300 text-sm font-semibold rounded-lg hover:bg-red-900/30 transition-colors">
                  Reject
                </button>
              </>
            )}
            {rfq.status === 'reviewed' && (
              <button onClick={() => setConfirmOpen(true)} disabled={converting}
                className="px-5 py-2 bg-accent-500 text-white text-sm font-semibold rounded-lg hover:bg-accent-600 transition-colors disabled:opacity-60 flex items-center gap-2">
                {converting && <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                Convert to Quotation
              </button>
            )}
            {rfq.status === 'converted' && rfq.converted_quotation_id && (
              <Link href={`/admin/quotations/${rfq.converted_quotation_id}`}
                className="px-5 py-2 border-2 border-accent-500 text-accent-400 text-sm font-semibold rounded-lg hover:bg-accent-900/20 transition-colors">
                View Quotation →
              </Link>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Items', value: String(items.length) },
            { label: 'Catalog Value', value: totalCatalog > 0 ? `₹${totalCatalog.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—' },
            { label: 'Requested Value', value: totalRequested > 0 ? `₹${totalRequested.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—' },
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
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Items — card layout */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">
              Requested Items <span className="ml-1 text-foreground-muted font-normal normal-case">({items.length})</span>
            </h2>
            {totalRequested > 0 && totalCatalog > 0 && (
              <span className="text-xs text-foreground-muted">
                Discount requested: <span className="font-semibold text-accent-500">
                  {Math.round(((totalCatalog - totalRequested) / totalCatalog) * 100)}%
                </span>
              </span>
            )}
          </div>

          {items.length === 0 ? (
            <div className="bg-surface-elevated rounded-xl border border-border-default p-8 text-center text-foreground-muted text-sm">
              No items found.
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((item, i) => {
                const catalogPrice = resolveItemPrice(item)
                const sku = resolveItemSku(item)
                const discount = (item.requested_price != null && catalogPrice != null && catalogPrice > 0)
                  ? Math.round(((catalogPrice - Number(item.requested_price)) / catalogPrice) * 100)
                  : null
                const itemCatalogTotal = catalogPrice != null ? catalogPrice * item.quantity : null
                const itemRequestedTotal = item.requested_price != null ? Number(item.requested_price) * item.quantity : null

                return (
                  <div key={item.id} className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
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
                                <span className="text-[11px] font-mono text-foreground-muted bg-surface px-1.5 py-0.5 rounded border border-border-default">
                                  SKU: {sku}
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
                          <div className="shrink-0 text-right space-y-1 min-w-[120px]">
                            {catalogPrice != null && (
                              <div>
                                <p className="text-[10px] text-foreground-muted uppercase tracking-wide">Catalog</p>
                                <p className="text-sm font-medium text-foreground-secondary">
                                  ₹{catalogPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                  <span className="text-foreground-muted text-[10px] ml-0.5">/unit</span>
                                </p>
                              </div>
                            )}
                            {item.requested_price != null ? (
                              <div>
                                <p className="text-[10px] text-foreground-muted uppercase tracking-wide">Requested</p>
                                <p className="text-sm font-bold text-accent-500">
                                  ₹{Number(item.requested_price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                  <span className="text-foreground-muted font-normal text-[10px] ml-0.5">/unit</span>
                                </p>
                                {discount != null && discount > 0 && (
                                  <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 mt-0.5">
                                    {discount}% off
                                  </span>
                                )}
                                {discount != null && discount <= 0 && (
                                  <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 mt-0.5">
                                    At/above catalog
                                  </span>
                                )}
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
                        {(itemCatalogTotal != null || itemRequestedTotal != null) && (
                          <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border-default">
                            {itemCatalogTotal != null && (
                              <div className="text-xs text-foreground-muted">
                                Catalog total:&nbsp;
                                <span className="text-foreground font-medium">
                                  ₹{itemCatalogTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                </span>
                              </div>
                            )}
                            {itemRequestedTotal != null && (
                              <div className="text-xs text-foreground-muted">
                                Requested total:&nbsp;
                                <span className="font-semibold text-accent-500">
                                  ₹{itemRequestedTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                </span>
                              </div>
                            )}
                            {itemCatalogTotal != null && itemRequestedTotal != null && itemCatalogTotal > itemRequestedTotal && (
                              <div className="ml-auto text-xs text-green-600 dark:text-green-400 font-medium">
                                Saves ₹{(itemCatalogTotal - itemRequestedTotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </div>
                            )}
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
          {(totalCatalog > 0 || totalRequested > 0) && (
            <div className="bg-surface-elevated rounded-xl border border-border-default p-4 flex flex-wrap items-center gap-6">
              {totalCatalog > 0 && (
                <div>
                  <p className="text-xs text-foreground-muted mb-0.5">Total Catalog Value</p>
                  <p className="font-semibold text-foreground">₹{totalCatalog.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                </div>
              )}
              {totalRequested > 0 && (
                <div>
                  <p className="text-xs text-foreground-muted mb-0.5">Total Requested Value</p>
                  <p className="font-bold text-accent-500">₹{totalRequested.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                </div>
              )}
              {totalCatalog > 0 && totalRequested > 0 && totalCatalog > totalRequested && (
                <div className="ml-auto">
                  <p className="text-xs text-foreground-muted mb-0.5">Total Discount Requested</p>
                  <p className="font-bold text-green-600 dark:text-green-400">
                    ₹{(totalCatalog - totalRequested).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    <span className="text-xs font-normal text-foreground-muted ml-1">
                      ({Math.round(((totalCatalog - totalRequested) / totalCatalog) * 100)}%)
                    </span>
                  </p>
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
              <Link href={`/admin/business/customers/${rfq.user_id}`}
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
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4">
              <p className="text-sm text-green-700 dark:text-green-400 font-medium mb-2">Converted to quotation</p>
              <Link href={`/admin/quotations/${rfq.converted_quotation_id}`}
                className="text-sm font-semibold text-accent-600 dark:text-accent-400 hover:underline">
                Open Quotation →
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
