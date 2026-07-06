'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'

import { ap } from '@/lib/admin-path'

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

function formatDate(s: string) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

const STATUS_COLORS: Record<string, string> = {
  paid: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  partial: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  unpaid: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

const METHOD_LABELS: Record<string, string> = {
  bank_transfer: 'Bank Transfer',
  upi: 'UPI',
  cash: 'Cash',
  cheque: 'Cheque',
}

export default function PayableDetailClient({ id }: { id: string }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/admin/financial/payables/${id}`)
      .then(r => r.json())
      .then(j => { setData(j); setLoading(false) })
      .catch(() => setLoading(false))
  }, [id])

  if (!loading && !data?.expense) {
    return (
      <div className="p-6">
        <p className="text-foreground-secondary">Expense not found.</p>
        <Link href={ap('/admin/financial?tab=payables')} className="text-accent-500 hover:underline text-sm mt-2 inline-block">← Back to Payables</Link>
      </div>
    )
  }

  if (loading || !data?.expense) {
    return (
      <div className="p-4 sm:p-6 space-y-6 animate-fade-in">
        {/* Breadcrumb */}
        <div className="h-4 w-40 bg-surface-secondary rounded animate-pulse" />
        {/* Header */}
        <div className="flex items-center gap-2">
          <div className="h-7 w-36 bg-surface-secondary rounded animate-pulse" />
          <div className="h-5 w-14 bg-surface-secondary rounded-full animate-pulse" />
        </div>
        {/* Info cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-surface-elevated rounded-xl border border-border-default p-4 space-y-3" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="h-3 w-24 bg-surface-secondary rounded animate-pulse" />
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, j) => (
                  <div key={j} className="flex justify-between gap-4 animate-pulse" style={{ animationDelay: `${j * 40}ms` }}>
                    <div className="h-3.5 w-20 bg-surface-secondary rounded shrink-0" />
                    <div className="h-3.5 bg-surface-secondary rounded flex-1" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {/* Payment history table */}
        <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
          <div className="px-4 py-3 border-b border-border-default">
            <div className="h-4 w-32 bg-surface-secondary rounded animate-pulse" />
          </div>
          <div className="p-4 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex gap-4 animate-pulse" style={{ animationDelay: `${i * 50}ms` }}>
                <div className="h-4 w-24 bg-surface-secondary rounded shrink-0" />
                <div className="h-4 w-20 bg-surface-secondary rounded shrink-0" />
                <div className="h-4 w-20 bg-surface-secondary rounded shrink-0" />
                <div className="h-4 bg-surface-secondary rounded flex-1" />
                <div className="h-4 w-16 bg-surface-secondary rounded shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  const e = data.expense
  const payments: any[] = data.payments || []
  const totalPaid = payments.reduce((s: number, p: any) => s + parseFloat(p.amount), 0)
  const remaining = parseFloat(e.total_amount) - totalPaid

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center gap-2 mb-6 text-sm">
        <a href={ap('/admin/financial')} className="flex items-center gap-1.5 text-foreground-muted hover:text-foreground transition-colors">
          <ChevronLeft className="w-4 h-4" />
          Financial
        </a>
        <span className="text-border-default">/</span>
        <span className="text-foreground font-medium">Payable Detail</span>
      </div>

      <div className="flex items-center gap-2">
        <Link href={ap('/admin/financial')} className="text-foreground-secondary hover:text-foreground transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-xl font-bold text-foreground font-mono">{e.expense_number}</h1>
        <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[e.status] || 'bg-surface-secondary text-foreground-secondary'}`}>
          {e.status}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-surface-elevated rounded-xl border border-border-default p-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Bill Details</p>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-foreground-secondary">Supplier</span>
              <span className="font-medium text-foreground text-right">{e.supplier_name}</span>
            </div>
            {e.supplier_gstin && (
              <div className="flex justify-between gap-4">
                <span className="text-foreground-secondary">GSTIN</span>
                <span className="font-mono text-xs text-foreground">{e.supplier_gstin}</span>
              </div>
            )}
            {e.description && (
              <div className="flex justify-between gap-4">
                <span className="text-foreground-secondary">Description</span>
                <span className="text-foreground text-right">{e.description}</span>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <span className="text-foreground-secondary">Bill Date</span>
              <span className="text-foreground">{formatDate(e.expense_date)}</span>
            </div>
            {e.due_date && (
              <div className="flex justify-between gap-4">
                <span className="text-foreground-secondary">Due Date</span>
                <span className={`font-medium ${new Date(e.due_date) < new Date() && e.status !== 'paid' ? 'text-red-600 dark:text-red-400' : 'text-foreground'}`}>
                  {formatDate(e.due_date)}
                </span>
              </div>
            )}
            {e.notes && (
              <div className="flex justify-between gap-4">
                <span className="text-foreground-secondary">Notes</span>
                <span className="text-foreground text-right">{e.notes}</span>
              </div>
            )}
          </div>
        </div>

        <div className="bg-surface-elevated rounded-xl border border-border-default p-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Amounts</p>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-foreground-secondary">Base Amount</span>
              <span className="text-foreground">{formatINR(parseFloat(e.amount))}</span>
            </div>
            {parseFloat(e.tax_amount) > 0 && (
              <div className="flex justify-between gap-4">
                <span className="text-foreground-secondary">Tax</span>
                <span className="text-foreground">{formatINR(parseFloat(e.tax_amount))}</span>
              </div>
            )}
            <div className="flex justify-between gap-4 pt-1 border-t border-border-default">
              <span className="font-semibold text-foreground">Total</span>
              <span className="font-bold text-foreground">{formatINR(parseFloat(e.total_amount))}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-foreground-secondary">Paid</span>
              <span className="text-green-600 dark:text-green-400 font-medium">{formatINR(totalPaid)}</span>
            </div>
            {remaining > 0 && (
              <div className="flex justify-between gap-4">
                <span className="text-foreground-secondary">Remaining</span>
                <span className="text-red-600 dark:text-red-400 font-semibold">{formatINR(remaining)}</span>
              </div>
            )}
          </div>
        </div>

        {e.po_number && (
          <div className="bg-surface-elevated rounded-xl border border-border-default p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Linked Purchase Order</p>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-foreground-secondary">PO #</span>
                <span className="font-mono font-medium text-foreground">{e.po_number}</span>
              </div>
              {e.po_status && (
                <div className="flex justify-between gap-4">
                  <span className="text-foreground-secondary">PO Status</span>
                  <span className="capitalize text-foreground">{e.po_status}</span>
                </div>
              )}
              {e.po_order_date && (
                <div className="flex justify-between gap-4">
                  <span className="text-foreground-secondary">Order Date</span>
                  <span className="text-foreground">{formatDate(e.po_order_date)}</span>
                </div>
              )}
              {e.po_expected_date && (
                <div className="flex justify-between gap-4">
                  <span className="text-foreground-secondary">Expected</span>
                  <span className="text-foreground">{formatDate(e.po_expected_date)}</span>
                </div>
              )}
              <Link
                href={ap(`/admin/inventory?po=${e.po_number}`)}
                className="inline-block mt-1 text-xs text-accent-500 hover:underline"
              >
                View in Inventory →
              </Link>
            </div>
          </div>
        )}
      </div>

      <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
        <div className="px-4 py-3 border-b border-border-default">
          <p className="text-sm font-semibold text-foreground">Payment History</p>
        </div>
        {payments.length === 0 ? (
          <p className="text-foreground-secondary text-sm text-center py-8">No payments recorded yet</p>
        ) : (
          <>
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-secondary">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Date</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Method</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Amount</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Reference / UTR</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Payout ID</th>
                    <th className="px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-foreground-secondary">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-default">
                  {payments.map((p: any) => (
                    <tr key={p.id} className="hover:bg-surface-secondary/40 transition-colors">
                      <td className="px-4 py-3 text-foreground-secondary whitespace-nowrap">{formatDate(p.payment_date)}</td>
                      <td className="px-4 py-3 text-foreground-secondary">{METHOD_LABELS[p.payment_method] || p.payment_method}</td>
                      <td className="px-4 py-3 text-right font-semibold text-foreground">{formatINR(parseFloat(p.amount))}</td>
                      <td className="px-4 py-3 text-xs text-foreground-secondary font-mono">{p.reference || '—'}</td>
                      <td className="px-4 py-3 text-xs text-foreground-secondary font-mono">{p.payout_id || '—'}</td>
                      <td className="px-4 py-3 text-center">
                        {p.payout_status ? (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            p.payout_status === 'processed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                            p.payout_status === 'failed' || p.payout_status === 'reversed' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                            'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                          }`}>{p.payout_status}</span>
                        ) : <span className="text-foreground-secondary text-xs">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="sm:hidden divide-y divide-border-default">
              {payments.map((p: any) => (
                <div key={p.id} className="p-4 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-foreground-secondary">{formatDate(p.payment_date)}</span>
                    <span className="font-semibold text-foreground text-sm">{formatINR(parseFloat(p.amount))}</span>
                  </div>
                  <div className="text-xs text-foreground-secondary">{METHOD_LABELS[p.payment_method] || p.payment_method}</div>
                  {(p.reference || p.payout_id) && (
                    <div className="text-xs text-foreground-secondary font-mono">{p.payout_id || p.reference}</div>
                  )}
                  {p.payout_status && (
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                      p.payout_status === 'processed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                      p.payout_status === 'failed' || p.payout_status === 'reversed' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                      'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                    }`}>{p.payout_status}</span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
