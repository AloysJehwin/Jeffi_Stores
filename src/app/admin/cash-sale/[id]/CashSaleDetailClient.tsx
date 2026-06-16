'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ap } from '@/lib/admin-path'

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n)
}

function formatDate(s: string) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

const PAYMENT_MODE_LABELS: Record<string, string> = {
  cash: 'Cash',
  upi: 'UPI',
  upi_qr: 'UPI (QR)',
  credit: 'Credit',
}

export default function CashSaleDetailClient({ id }: { id: string }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/admin/cash-sale/${id}/detail`)
      .then(r => r.json())
      .then(j => { setData(j); setLoading(false) })
      .catch(() => setLoading(false))
  }, [id])

  if (!loading && !data?.sale) {
    return (
      <div className="p-6">
        <p className="text-foreground-secondary">Sale not found.</p>
        <Link href={ap('/admin/invoices')} className="text-accent-500 hover:underline text-sm mt-2 inline-block">← Back to Invoices</Link>
      </div>
    )
  }

  if (loading || !data?.sale) {
    return null
  }

  const s = data.sale
  const items: any[] = data.items || []

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={ap('/admin/invoices')} className="text-foreground-secondary hover:text-foreground transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-xl font-bold text-foreground font-mono">{s.invoice_number || s.sale_number}</h1>
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
            Cash Sale
          </span>
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
            s.payment_status === 'paid'
              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
          }`}>
            {s.payment_status}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/api/admin/cash-sale/${s.id}/receipt`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-500 text-white text-sm font-medium hover:bg-accent-600 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Receipt PDF
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-surface-elevated rounded-xl border border-border-default p-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Sale Details</p>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-foreground-secondary">Invoice #</span>
              <span className="font-mono font-medium text-foreground">{s.invoice_number || '—'}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-foreground-secondary">Sale #</span>
              <span className="font-mono text-foreground">{s.sale_number}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-foreground-secondary">Date</span>
              <span className="text-foreground">{formatDate(s.invoice_date || s.created_at)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-foreground-secondary">Payment</span>
              <span className="text-foreground">{PAYMENT_MODE_LABELS[s.payment_mode] || s.payment_mode || '—'}</span>
            </div>
          </div>
        </div>

        <div className="bg-surface-elevated rounded-xl border border-border-default p-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Customer</p>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-foreground-secondary">Name</span>
              <span className="font-medium text-foreground text-right">{s.customer_name || 'Walk-in Customer'}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
        <div className="px-4 py-3 border-b border-border-default">
          <p className="text-sm font-semibold text-foreground">Line Items</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-secondary">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Item</th>
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
                  </td>
                  <td className="px-4 py-3 text-center text-xs text-foreground-secondary">{item.gst_rate}%</td>
                  <td className="px-4 py-3 text-center text-foreground">{item.quantity}</td>
                  <td className="px-4 py-3 text-right text-foreground">{formatINR(parseFloat(item.unit_price))}</td>
                  <td className="px-4 py-3 text-right text-foreground-secondary">{formatINR(parseFloat(item.taxable_amount || '0'))}</td>
                  <td className="px-4 py-3 text-right text-foreground-secondary">
                    {formatINR(parseFloat(item.cgst_amount || '0') + parseFloat(item.sgst_amount || '0') + parseFloat(item.igst_amount || '0'))}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-foreground">{formatINR(parseFloat(item.total_price))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border-t border-border-default px-4 py-3">
          <div className="ml-auto max-w-xs space-y-1.5 text-sm">
            <div className="flex justify-between gap-8">
              <span className="text-foreground-secondary">Taxable Amount</span>
              <span className="text-foreground">{formatINR(parseFloat(s.taxable_amount || '0'))}</span>
            </div>
            {parseFloat(s.igst_amount || '0') > 0 ? (
              <div className="flex justify-between gap-8">
                <span className="text-foreground-secondary">IGST</span>
                <span className="text-foreground">{formatINR(parseFloat(s.igst_amount))}</span>
              </div>
            ) : (
              <>
                {parseFloat(s.cgst_amount || '0') > 0 && (
                  <div className="flex justify-between gap-8">
                    <span className="text-foreground-secondary">CGST</span>
                    <span className="text-foreground">{formatINR(parseFloat(s.cgst_amount))}</span>
                  </div>
                )}
                {parseFloat(s.sgst_amount || '0') > 0 && (
                  <div className="flex justify-between gap-8">
                    <span className="text-foreground-secondary">SGST</span>
                    <span className="text-foreground">{formatINR(parseFloat(s.sgst_amount))}</span>
                  </div>
                )}
              </>
            )}
            <div className="flex justify-between gap-8 pt-1.5 border-t border-border-default">
              <span className="font-semibold text-foreground">Total</span>
              <span className="font-bold text-foreground text-base">{formatINR(parseFloat(s.total_amount))}</span>
            </div>
          </div>
        </div>
      </div>

      {s.notes && (
        <div className="bg-surface-elevated rounded-xl border border-border-default p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary mb-1.5">Notes</p>
          <p className="text-sm text-foreground">{s.notes}</p>
        </div>
      )}
    </div>
  )
}
