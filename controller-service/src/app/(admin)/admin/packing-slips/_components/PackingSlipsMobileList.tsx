'use client'

import { useState } from 'react'
import { ap } from '@/lib/shared/admin-path'
import MobileListCard from '@/components/admin/mobile/MobileListCard'
import MobileDetailSheet from '@/components/admin/mobile/MobileDetailSheet'
import MobileActionSheet, { type MobileAction } from '@/components/admin/mobile/MobileActionSheet'
import { DOC_META, docAvailable, type DocKey, type DocOrder } from './order-documents'

interface Order extends DocOrder {
  customer_name: string
  created_at: string
  status: string
  total_amount: number
}

interface Props {
  orders: Order[]
  statusColors: Record<string, string>
  statusLabel: (s: string) => string
  selectedIds: Set<string>
  onToggleOne: (id: string) => void
  /** The documents this admin can download one by one. */
  docs: DocKey[]
  /** The chosen set when it's more than one document, e.g. "invoice + packing slip". */
  setLabel: string | null
  setReady: (order: Order) => boolean
  onDownload: (order: Order, docs: DocKey[] | 'set') => void
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtAmount(n: number) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function PackingSlipsMobileList({
  orders,
  statusColors,
  statusLabel,
  selectedIds,
  onToggleOne,
  docs,
  setLabel,
  setReady,
  onDownload,
}: Props) {
  const [selected, setSelected] = useState<Order | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)

  function buildActions(order: Order): MobileAction[] {
    return [
      ...(setLabel
        ? [{ key: 'set', label: `Download ${setLabel}`, disabled: !setReady(order), onSelect: () => onDownload(order, 'set') }]
        : []),
      ...docs.map(doc => ({
        key: doc,
        label: docAvailable(order, doc)
          ? `Download ${DOC_META[doc].label.toLowerCase()}`
          : `${DOC_META[doc].label}: ${DOC_META[doc].unavailable.toLowerCase()}`,
        disabled: !docAvailable(order, doc),
        onSelect: () => onDownload(order, [doc]),
      })),
      {
        key: 'order',
        label: 'View order',
        onSelect: () => {
          window.location.href = ap(`/admin/orders/${order.id}/view`)
        },
      },
      {
        key: 'select',
        label: selectedIds.has(order.id) ? 'Deselect for bulk' : 'Select for bulk download',
        onSelect: () => onToggleOne(order.id),
      },
    ]
  }

  return (
    <>
      {orders.map(order => (
        <MobileListCard
          key={order.id}
          accent={selectedIds.has(order.id)}
          ariaLabel={`Open order ${order.order_number}`}
          onTap={() => setSelected(order)}
        >
          <div className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={selectedIds.has(order.id)}
              onChange={() => onToggleOne(order.id)}
              onClick={e => e.stopPropagation()}
              className="mt-0.5 rounded border-border-default accent-secondary-500"
              aria-label={`Select order ${order.order_number}`}
            />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono font-medium text-foreground text-sm truncate">#{order.order_number}</span>
                <span className="shrink-0 font-medium text-foreground text-sm">
                  &#8377;{fmtAmount(Number(order.total_amount))}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-foreground truncate">{order.customer_name || '-'}</span>
                <span className="shrink-0 text-xs text-foreground-muted">{fmtDate(order.created_at)}</span>
              </div>
              <span
                className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[order.status] || 'bg-surface-secondary text-foreground-secondary'}`}
              >
                {statusLabel(order.status)}
              </span>
            </div>
          </div>
        </MobileListCard>
      ))}

      <MobileDetailSheet
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `#${selected.order_number}` : ''}
        subtitle={selected?.customer_name || undefined}
        footer={
          <button
            type="button"
            onClick={() => setActionsOpen(true)}
            className="w-full bg-secondary-500 hover:bg-secondary-600 text-white text-sm font-semibold py-3 rounded-lg transition-colors"
          >
            Actions
          </button>
        }
      >
        {selected && (
          <div className="px-5 py-4 space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-foreground-secondary">Customer</span>
              <span className="text-foreground font-medium">{selected.customer_name || '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-foreground-secondary">Date</span>
              <span className="text-foreground">{fmtDate(selected.created_at)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-foreground-secondary">Status</span>
              <span
                className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[selected.status] || 'bg-surface-secondary text-foreground-secondary'}`}
              >
                {statusLabel(selected.status)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-foreground-secondary">Total</span>
              <span className="text-foreground font-semibold">&#8377;{fmtAmount(Number(selected.total_amount))}</span>
            </div>
          </div>
        )}
      </MobileDetailSheet>

      <MobileActionSheet
        open={actionsOpen && !!selected}
        onClose={() => setActionsOpen(false)}
        title={selected ? `#${selected.order_number}` : undefined}
        actions={selected ? buildActions(selected) : []}
      />
    </>
  )
}
