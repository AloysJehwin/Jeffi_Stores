'use client'

import { useState } from 'react'
import { Check, Download, Eye, Mail, Pencil, X } from 'lucide-react'
import { ap } from '@/lib/shared/admin-path'
import MobileListCard from '@/components/admin/mobile/MobileListCard'
import MobileDetailSheet from '@/components/admin/mobile/MobileDetailSheet'
import MobileActionSheet, { type MobileAction } from '@/components/admin/mobile/MobileActionSheet'
import { type Invoice, PAYMENT_COLORS, SOURCE_COLORS } from '../InvoicesClient'

interface Props {
  invoices: Invoice[]
  canWrite: boolean
  sendingEmailId: string | null
  cancellingId: string | null
  onSendEmail: (inv: Invoice) => void
  onEdit: (inv: Invoice) => void
  onCancel: (inv: Invoice) => void
}

function fmt(n: number) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(s: string) {
  if (!s) return ''
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function sourceLabel(source: string) {
  return source === 'online' ? 'Online' : source === 'business' ? 'Business' : 'Offline'
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-foreground-muted">{label}</p>
      <p className="text-sm text-foreground font-medium break-words">{value}</p>
    </div>
  )
}

export default function InvoicesMobileList({
  invoices,
  canWrite,
  sendingEmailId,
  cancellingId,
  onSendEmail,
  onEdit,
  onCancel,
}: Props) {
  const [selected, setSelected] = useState<Invoice | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)

  function viewHref(inv: Invoice) {
    return ap(inv.source === 'cash_sale' ? `/admin/cash-sale/${inv.id}` : `/admin/invoices/${inv.id}`)
  }

  function pdfHref(inv: Invoice) {
    return inv.source === 'cash_sale' ? `/api/admin/cash-sale/${inv.id}/receipt` : `/api/orders/${inv.id}/invoice`
  }

  function buildActions(inv: Invoice): MobileAction[] {
    const actions: MobileAction[] = [
      {
        key: 'view',
        label: inv.source === 'cash_sale' ? 'View sale' : 'View invoice',
        icon: <Eye className="w-4 h-4" />,
        onSelect: () => window.open(viewHref(inv), '_self'),
      },
      {
        key: 'pdf',
        label: inv.source === 'cash_sale' ? 'Download receipt PDF' : 'Download invoice PDF',
        icon: <Download className="w-4 h-4" />,
        onSelect: () => window.open(pdfHref(inv), '_blank', 'noopener,noreferrer'),
      },
    ]
    if (inv.source !== 'cash_sale') {
      if (inv.customer_email) {
        actions.push({
          key: 'email',
          label: 'Send email',
          icon: <Mail className="w-4 h-4" />,
          disabled: sendingEmailId === inv.id,
          onSelect: () => onSendEmail(inv),
        })
      }
      if (inv.source === 'offline' && inv.status !== 'cancelled' && canWrite) {
        actions.push({
          key: 'edit',
          label: 'Edit invoice',
          icon: <Pencil className="w-4 h-4" />,
          onSelect: () => onEdit(inv),
        })
        actions.push({
          key: 'cancel',
          label: 'Cancel invoice',
          icon: <X className="w-4 h-4" />,
          danger: true,
          disabled: cancellingId === inv.id,
          onSelect: () => onCancel(inv),
        })
      }
    }
    return actions
  }

  return (
    <div className="md:hidden divide-y divide-border-default">
      {invoices.map(inv => (
        <div key={inv.id} className="py-3 first:pt-0 last:pb-0">
          <MobileListCard ariaLabel={`Open invoice ${inv.invoice_number}`} onTap={() => setSelected(inv)}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-mono font-semibold text-sm text-foreground truncate">{inv.invoice_number}</div>
                {inv.order_number && (
                  <div className="text-xs text-foreground-muted mt-0.5 font-mono truncate">{inv.order_number}</div>
                )}
              </div>
              <span className="font-semibold text-foreground text-sm shrink-0">₹{fmt(parseFloat(inv.total_amount))}</span>
            </div>
            <div className="flex items-center justify-between gap-2 mt-2">
              <span className="text-sm text-foreground font-medium truncate">{inv.customer_name}</span>
              <span className="text-xs text-foreground-muted shrink-0">{fmtDate(inv.invoice_date)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PAYMENT_COLORS[inv.payment_status] || ''}`}>
                {inv.payment_status}
              </span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${SOURCE_COLORS[inv.source] || ''}`}>
                {sourceLabel(inv.source)}
              </span>
              {inv.status === 'cancelled' && (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                  Cancelled
                </span>
              )}
              {inv.irn && (
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium inline-flex items-center gap-1 ${
                    inv.irn_status === 'generated'
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                      : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'
                  }`}
                >
                  {inv.irn_status === 'generated' ? (
                    <>
                      <Check className="w-3 h-3" /> IRN
                    </>
                  ) : (
                    'IRN Stub'
                  )}
                </span>
              )}
            </div>
          </MobileListCard>
        </div>
      ))}

      <MobileDetailSheet
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.invoice_number}
        subtitle={selected ? fmtDate(selected.invoice_date) : undefined}
        footer={
          <button
            type="button"
            onClick={() => setActionsOpen(true)}
            className="w-full bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold py-3 rounded-lg transition-colors"
          >
            Actions
          </button>
        }
      >
        {selected && (
          <div className="p-5 space-y-4">
            <div className="flex flex-wrap gap-2">
              <span
                className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${PAYMENT_COLORS[selected.payment_status] || ''}`}
              >
                {selected.payment_status}
              </span>
              <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${SOURCE_COLORS[selected.source] || ''}`}>
                {sourceLabel(selected.source)}
              </span>
              {selected.status === 'cancelled' && (
                <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                  Cancelled
                </span>
              )}
            </div>
            <div>
              <p className="text-xs text-foreground-muted uppercase tracking-wide mb-1">Total</p>
              <p className="text-xl font-bold text-primary-500">₹{fmt(parseFloat(selected.total_amount))}</p>
              {parseFloat(selected.taxable_amount) > 0 && (
                <p className="text-xs text-foreground-muted mt-0.5">Taxable ₹{fmt(parseFloat(selected.taxable_amount))}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border-default pt-4">
              <Field label="Customer" value={selected.customer_name || '—'} />
              <Field label="Phone" value={selected.customer_phone ? `+91 ${selected.customer_phone}` : '—'} />
              <Field label="Order" value={selected.order_number || '—'} />
              <Field label="GSTIN" value={selected.buyer_gstin || '—'} />
            </div>
          </div>
        )}
      </MobileDetailSheet>

      <MobileActionSheet
        open={actionsOpen && !!selected}
        onClose={() => setActionsOpen(false)}
        title={selected?.invoice_number}
        actions={selected ? buildActions(selected) : []}
      />
    </div>
  )
}
