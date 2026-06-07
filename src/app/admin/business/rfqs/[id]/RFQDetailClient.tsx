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
  variant_name: string | null
  sub_variant_name: string | null
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

export default function RFQDetailClient({ id }: { id: string }) {
  const [rfq, setRfq] = useState<RFQ | null>(null)
  const [items, setItems] = useState<RFQItem[]>([])
  const [loading, setLoading] = useState(true)
  const [converting, setConverting] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [adminNote, setAdminNote] = useState('')
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

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

  const handleConvert = async () => {
    if (!confirm('Convert this RFQ to a quotation? Rates will start at ₹0 — fill them in after.')) return
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

  const totalRequested = items.reduce((sum, i) => sum + (i.requested_price ? i.requested_price * i.quantity : 0), 0)

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
              <button onClick={handleConvert} disabled={converting}
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
            { label: 'Total Requested', value: totalRequested > 0 ? `₹${totalRequested.toLocaleString('en-IN')}` : '—' },
            { label: 'GST Number', value: rfq.gst_number || '—' },
            { label: 'Contact', value: `${rfq.first_name} ${rfq.last_name || ''}`.trim() },
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
        {/* Items table */}
        <div className="lg:col-span-2">
          <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
            <div className="px-5 py-4 border-b border-border-default flex items-center justify-between">
              <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">Requested Items</h2>
              <span className="text-xs text-foreground-muted">{items.length} item{items.length !== 1 ? 's' : ''}</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-default">
                  <th className="px-5 py-3 text-left text-xs font-semibold text-foreground-muted w-8">#</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-foreground-muted">Description</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-foreground-muted">Qty</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-foreground-muted">Target Price</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-foreground-muted">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {items.length === 0 ? (
                  <tr><td colSpan={5} className="px-5 py-8 text-center text-foreground-muted">No items</td></tr>
                ) : items.map((item, i) => (
                  <tr key={item.id} className="hover:bg-surface-secondary/50 transition-colors">
                    <td className="px-5 py-3.5 text-foreground-muted font-mono text-xs">{i + 1}</td>
                    <td className="px-5 py-3.5">
                      <p className="font-medium text-foreground">{item.description}</p>
                      {item.product_name && <p className="text-xs text-foreground-muted mt-0.5">{item.product_name}{item.variant_name ? ` — ${item.variant_name}` : ''}{item.sub_variant_name ? ` / ${item.sub_variant_name}` : ''}</p>}
                      {item.notes && <p className="text-xs text-foreground-muted italic mt-0.5">{item.notes}</p>}
                    </td>
                    <td className="px-5 py-3.5 text-right text-foreground font-medium">
                      {item.quantity} <span className="text-foreground-muted font-normal">{item.unit}</span>
                    </td>
                    <td className="px-5 py-3.5 text-right text-foreground">
                      {item.requested_price != null ? `₹${Number(item.requested_price).toLocaleString('en-IN')}` : <span className="text-foreground-muted">—</span>}
                    </td>
                    <td className="px-5 py-3.5 text-right font-semibold text-foreground">
                      {item.requested_price != null
                        ? `₹${(Number(item.requested_price) * item.quantity).toLocaleString('en-IN')}`
                        : <span className="text-foreground-muted font-normal">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
              {totalRequested > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-border-default bg-surface-secondary/40">
                    <td colSpan={4} className="px-5 py-3 text-right text-sm font-semibold text-foreground-secondary">Total Requested Value</td>
                    <td className="px-5 py-3 text-right font-bold text-foreground">₹{totalRequested.toLocaleString('en-IN')}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* Right — details + notes */}
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
          </div>

          {/* Customer notes */}
          {rfq.notes && (
            <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
              <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-3">Customer Note</h2>
              <p className="text-sm text-foreground">{rfq.notes}</p>
            </div>
          )}

          {/* Admin note */}
          {rfq.admin_note && (
            <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
              <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-3">Admin Note</h2>
              <p className="text-sm text-foreground">{rfq.admin_note}</p>
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
