'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, Pencil } from 'lucide-react'
import { ap } from '@/lib/admin-path'
import { useConfirm } from '@/contexts/ConfirmContext'

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n)
}

function formatDate(s: string) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

const STATUS_COLORS: Record<string, string> = {
  draft:    'bg-surface-secondary text-foreground-secondary',
  final:    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  accepted: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  expired:  'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
}

export default function QuotationDetailClient({ id }: { id: string }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [finalizing, setFinalizing] = useState(false)
  const [finalizeError, setFinalizeError] = useState('')
  const confirm = useConfirm()

  useEffect(() => {
    fetch(`/api/admin/quotations/${id}`)
      .then(r => r.json())
      .then(j => { setData(j); setLoading(false) })
      .catch(() => setLoading(false))
  }, [id])

  async function finalize() {
    const ok = await confirm({
      title: 'Finalize Quotation?',
      message: 'This will mark the quotation as Final and send a confirmation email to the customer if an email address is on record. This action cannot be undone.',
      confirmLabel: 'Yes, Finalize',
      cancelLabel: 'Cancel',
    })
    if (!ok) return
    setFinalizing(true)
    setFinalizeError('')
    try {
      const res = await fetch(`/api/admin/quotations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'final' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to finalize')
      setData((prev: any) => ({ ...prev, quotation: json.quotation }))
    } catch (e: any) {
      setFinalizeError(e.message || 'Failed to finalize')
    } finally {
      setFinalizing(false)
    }
  }

  if (!loading && !data?.quotation) {
    return (
      <div className="p-6">
        <p className="text-foreground-secondary">Quotation not found.</p>
        <Link href={ap('/admin/quotations')} className="text-accent-500 hover:underline text-sm mt-2 inline-block">← Back to Quotations</Link>
      </div>
    )
  }

  if (loading || !data?.quotation) {
    return null
  }

  const q = data.quotation
  const items: any[] = data.items || []

  // Recompute totals from items when stored values are zero (e.g. legacy RFQ-converted quotations)
  const computedSubtotal = items.reduce((s, i) => s + parseFloat(i.amount || '0'), 0)
  const computedCgst = items.reduce((s, i) => s + parseFloat(i.amount || '0') * parseFloat(i.gst_rate || '0') / 200, 0)
  const computedSgst = computedCgst
  const storedSubtotal = parseFloat(q.subtotal || '0')
  const subtotal = storedSubtotal > 0 ? storedSubtotal : computedSubtotal
  const cgstAmount = storedSubtotal > 0 ? parseFloat(q.cgst_amount || '0') : computedCgst
  const sgstAmount = storedSubtotal > 0 ? parseFloat(q.sgst_amount || '0') : computedSgst
  const totalAmount = storedSubtotal > 0 ? parseFloat(q.total_amount || '0') : (computedSubtotal + computedCgst + computedSgst)

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <a href={ap('/admin/quotations')} className="flex items-center gap-1.5 text-foreground-muted hover:text-foreground transition-colors">
          <ChevronLeft className="w-4 h-4" />
          Quotations
        </a>
        <span className="text-border-default">/</span>
        <span className="text-foreground font-medium">Quotation #{q.quote_number}</span>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-foreground font-mono">{q.quote_number}</h1>
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${STATUS_COLORS[q.status] || 'bg-surface-secondary text-foreground-secondary'}`}>
            {q.status}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {q.status === 'draft' && !q.from_rfq && (
            <a
              href={ap(`/admin/quotations?view=editor&edit=${q.id}`)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-default text-sm font-medium text-foreground hover:bg-surface-secondary transition-colors"
            >
              <Pencil className="w-4 h-4" />
              Edit
            </a>
          )}
          {q.status === 'draft' && q.from_rfq && (
            <button
              onClick={finalize}
              disabled={finalizing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-60"
            >
              {finalizing ? 'Finalizing…' : 'Finalize Quotation'}
            </button>
          )}
          <a
            href={`/api/admin/quotations/${q.id}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-500 text-white text-sm font-medium hover:bg-accent-600 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Download PDF
          </a>
          {q.converted_order_id && (
            <a
              href={ap(`/admin/invoices/${q.converted_order_id}`)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-default text-sm font-medium text-foreground hover:bg-surface-secondary transition-colors"
            >
              View Invoice →
            </a>
          )}
          <Link
            href={ap('/admin/quotations')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-default text-sm font-medium text-foreground hover:bg-surface-secondary transition-colors"
          >
            ← All Quotations
          </Link>
        </div>
      </div>

      {/* Info Cards */}
      {finalizeError && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {finalizeError}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Quotation Details */}
        <div className="bg-surface-elevated rounded-xl border border-border-default p-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Quotation Details</p>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-foreground-secondary">Quote #</span>
              <span className="font-mono font-medium text-foreground">{q.quote_number}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-foreground-secondary">Date</span>
              <span className="text-foreground">{formatDate(q.quote_date || q.created_at)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-foreground-secondary">Status</span>
              <span className="capitalize text-foreground">{q.status}</span>
            </div>
            {q.converted_order_id && (
              <div className="flex justify-between gap-4">
                <span className="text-foreground-secondary">Converted</span>
                <a href={ap(`/admin/invoices/${q.converted_order_id}`)} className="text-green-600 dark:text-green-400 text-xs font-medium hover:underline">
                  View Invoice ↗
                </a>
              </div>
            )}
          </div>
        </div>

        {/* Consignee */}
        <div className="bg-surface-elevated rounded-xl border border-border-default p-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Consignee</p>
          <div className="space-y-1.5 text-sm">
            {q.consignee_name && (
              <div className="flex justify-between gap-4">
                <span className="text-foreground-secondary">Name</span>
                <span className="font-medium text-foreground text-right">{q.consignee_name}</span>
              </div>
            )}
            {q.consignee_phone && (
              <div className="flex justify-between gap-4">
                <span className="text-foreground-secondary">Phone</span>
                <span className="text-foreground">{q.consignee_phone}</span>
              </div>
            )}
            {q.consignee_email && (
              <div className="flex justify-between gap-4">
                <span className="text-foreground-secondary">Email</span>
                <span className="text-foreground text-right text-xs">{q.consignee_email}</span>
              </div>
            )}
            {q.consignee_gstin && (
              <div className="flex justify-between gap-4">
                <span className="text-foreground-secondary">GSTIN</span>
                <span className="font-mono text-xs text-foreground">{q.consignee_gstin}</span>
              </div>
            )}
            {q.consignee_addr1 && (
              <div className="flex justify-between gap-4">
                <span className="text-foreground-secondary shrink-0">Address</span>
                <span className="text-foreground text-right text-xs">
                  {[q.consignee_addr1, q.consignee_addr2, q.consignee_city, q.consignee_state, q.consignee_pincode].filter(Boolean).join(', ')}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Buyer (if different) */}
        {!q.buyer_same && q.buyer_name && (
          <div className="bg-surface-elevated rounded-xl border border-border-default p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Buyer</p>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-foreground-secondary">Name</span>
                <span className="font-medium text-foreground text-right">{q.buyer_name}</span>
              </div>
              {q.buyer_phone && (
                <div className="flex justify-between gap-4">
                  <span className="text-foreground-secondary">Phone</span>
                  <span className="text-foreground">{q.buyer_phone}</span>
                </div>
              )}
              {q.buyer_gstin && (
                <div className="flex justify-between gap-4">
                  <span className="text-foreground-secondary">GSTIN</span>
                  <span className="font-mono text-xs text-foreground">{q.buyer_gstin}</span>
                </div>
              )}
              {q.buyer_addr1 && (
                <div className="flex justify-between gap-4">
                  <span className="text-foreground-secondary shrink-0">Address</span>
                  <span className="text-foreground text-right text-xs">
                    {[q.buyer_addr1, q.buyer_addr2, q.buyer_city, q.buyer_state, q.buyer_pincode].filter(Boolean).join(', ')}
                  </span>
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
                <th className="px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Unit</th>
                <th className="px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Qty</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Rate</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Disc%</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {items.map((item: any, idx: number) => (
                <tr key={idx} className="hover:bg-surface-secondary/40 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{item.description}</div>
                  </td>
                  <td className="px-4 py-3 text-center text-xs text-foreground-secondary font-mono">{item.hsn_code || '—'}</td>
                  <td className="px-4 py-3 text-center text-xs text-foreground-secondary">{item.gst_rate}%</td>
                  <td className="px-4 py-3 text-center text-xs text-foreground-secondary">{item.unit || 'PCS'}</td>
                  <td className="px-4 py-3 text-center text-foreground">
                    {parseFloat(item.quantity)}{item.sell_unit_dimension === 'count' && Number(item.sell_unit_factor) > 1 && (
                      <span className="text-xs text-foreground-secondary ml-1">× {parseFloat(item.sell_unit_factor)} = {Math.round(Number(item.quantity) * Number(item.sell_unit_factor))} pcs</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-foreground">{formatINR(parseFloat(item.rate))}</td>
                  <td className="px-4 py-3 text-right text-foreground-secondary">{item.discount_pct ? `${item.discount_pct}%` : '—'}</td>
                  <td className="px-4 py-3 text-right font-semibold text-foreground">{formatINR(parseFloat(item.amount))}</td>
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
              <span className="text-foreground">{formatINR(subtotal)}</span>
            </div>
            {cgstAmount > 0 && (
              <div className="flex justify-between gap-8">
                <span className="text-foreground-secondary">CGST</span>
                <span className="text-foreground">{formatINR(cgstAmount)}</span>
              </div>
            )}
            {sgstAmount > 0 && (
              <div className="flex justify-between gap-8">
                <span className="text-foreground-secondary">SGST</span>
                <span className="text-foreground">{formatINR(sgstAmount)}</span>
              </div>
            )}
            <div className="flex justify-between gap-8 pt-1.5 border-t border-border-default">
              <span className="font-semibold text-foreground">Total</span>
              <span className="font-bold text-foreground text-base">{formatINR(totalAmount)}</span>
            </div>
          </div>
        </div>
      </div>

      {q.notes && (
        <div className="bg-surface-elevated rounded-xl border border-border-default p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary mb-1.5">Notes</p>
          <p className="text-sm text-foreground">{q.notes}</p>
        </div>
      )}
    </div>
  )
}
