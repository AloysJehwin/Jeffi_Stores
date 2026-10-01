'use client'

import { useState } from 'react'
import { ExternalLink, Download, Mail, Trash2, FileText } from 'lucide-react'
import { ap } from '@/lib/shared/admin-path'
import MobileListCard from '@/components/admin/mobile/MobileListCard'
import MobileDetailSheet from '@/components/admin/mobile/MobileDetailSheet'
import MobileActionSheet, { type MobileAction } from '@/components/admin/mobile/MobileActionSheet'
import { type Quotation, STATUS_COLORS } from '../QuotationsClient'

interface Props {
  quotations: Quotation[]
  canWrite: boolean
  sendingEmailId: string | null
  onSendEmail: (id: string) => void
  onDelete: (id: string) => void
  onConvert: (q: Quotation) => void
}

function fmt2(n: number | string) {
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(d: string) {
  if (!d) return ''
  const dt = new Date(d)
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function statusLabel(status: string) {
  return status === 'final' ? 'Final' : 'Draft'
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-foreground-muted">{label}</p>
      <p className="text-sm text-foreground font-medium break-words">{value}</p>
    </div>
  )
}

export default function QuotationsMobileList({
  quotations,
  canWrite,
  sendingEmailId,
  onSendEmail,
  onDelete,
  onConvert,
}: Props) {
  const [selected, setSelected] = useState<Quotation | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)

  function buildActions(q: Quotation): MobileAction[] {
    const actions: MobileAction[] = [
      {
        key: 'view',
        label: 'View detail',
        icon: <ExternalLink className="w-4 h-4" />,
        onSelect: () => window.open(ap(`/admin/quotations/${q.id}`), '_self'),
      },
      {
        key: 'pdf',
        label: 'Download PDF',
        icon: <Download className="w-4 h-4" />,
        onSelect: () => window.open(`/api/admin/quotations/${q.id}/pdf`, '_blank', 'noopener,noreferrer'),
      },
    ]
    if (q.status === 'final' && q.consignee_email) {
      actions.push({
        key: 'email',
        label: 'Send email',
        icon: <Mail className="w-4 h-4" />,
        disabled: sendingEmailId === q.id,
        onSelect: () => onSendEmail(q.id),
      })
    }
    if (q.status === 'final' && !q.converted_order_id && canWrite) {
      actions.push({
        key: 'convert',
        label: 'Convert to invoice',
        icon: <FileText className="w-4 h-4" />,
        onSelect: () => onConvert(q),
      })
    }
    if (q.status === 'final' && q.converted_order_id) {
      actions.push({
        key: 'invoiced',
        label: 'View invoice',
        icon: <ExternalLink className="w-4 h-4" />,
        onSelect: () => window.open(ap(`/admin/invoices/${q.converted_order_id}`), '_self'),
      })
    }
    if (q.status === 'draft' && canWrite) {
      actions.push({
        key: 'delete',
        label: 'Delete quotation',
        icon: <Trash2 className="w-4 h-4" />,
        danger: true,
        onSelect: () => onDelete(q.id),
      })
    }
    return actions
  }

  return (
    <div className="md:hidden divide-y divide-border-default">
      {quotations.map(q => (
        <div key={q.id} className="py-3 first:pt-0 last:pb-0">
          <MobileListCard ariaLabel={`Open quotation ${q.quote_number}`} onTap={() => setSelected(q)}>
            <div className="flex items-start justify-between gap-2">
              <div className="font-mono font-semibold text-sm text-foreground truncate">{q.quote_number}</div>
              <span className="font-semibold text-foreground text-sm shrink-0">₹{fmt2(Number(q.total_amount))}</span>
            </div>
            <div className="flex items-center justify-between gap-2 mt-2">
              <span className="text-sm text-foreground font-medium truncate">{q.consignee_name || '—'}</span>
              <span className="text-xs text-foreground-muted shrink-0">{fmtDate(q.quote_date)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[q.status] || ''}`}>
                {statusLabel(q.status)}
              </span>
              {q.converted_order_id && (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                  Invoiced
                </span>
              )}
            </div>
          </MobileListCard>
        </div>
      ))}

      <MobileDetailSheet
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.quote_number}
        subtitle={selected ? fmtDate(selected.quote_date) : undefined}
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
              <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${STATUS_COLORS[selected.status] || ''}`}>
                {statusLabel(selected.status)}
              </span>
              {selected.converted_order_id && (
                <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                  Invoiced
                </span>
              )}
            </div>
            <div>
              <p className="text-xs text-foreground-muted uppercase tracking-wide mb-1">Total</p>
              <p className="text-xl font-bold text-primary-500">₹{fmt2(Number(selected.total_amount))}</p>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border-default pt-4">
              <Field label="Consignee" value={selected.consignee_name || '—'} />
              <Field label="Phone" value={selected.consignee_phone || '—'} />
              <Field
                label="City"
                value={
                  selected.consignee_city
                    ? `${selected.consignee_city}${selected.consignee_state ? `, ${selected.consignee_state}` : ''}`
                    : '—'
                }
              />
              <Field label="Email" value={selected.consignee_email || '—'} />
            </div>
          </div>
        )}
      </MobileDetailSheet>

      <MobileActionSheet
        open={actionsOpen && !!selected}
        onClose={() => setActionsOpen(false)}
        title={selected?.quote_number}
        actions={selected ? buildActions(selected) : []}
      />
    </div>
  )
}
