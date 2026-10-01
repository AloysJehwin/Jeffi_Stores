'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { formatINR as formatINRBase, formatDate } from '@/lib/shared/format'
import MobileListCard from '@/components/admin/mobile/MobileListCard'
import MobileDetailSheet from '@/components/admin/mobile/MobileDetailSheet'
import MobileActionSheet, { type MobileAction } from '@/components/admin/mobile/MobileActionSheet'

type PO = {
  id: string
  po_number: string
  supplier_id: string
  supplier_name: string
  supplier_email: string | null
  status: string
  order_date: string
  expected_date: string | null
  item_count: number
  total_amount: string
}

interface Props {
  pos: PO[]
  statusBadge: Record<string, string>
  sendingEmailId: string | null
  onView: (id: string) => void
  onSend: (id: string) => void
  onReceive: (id: string) => void
  onSendEmail: (po: PO) => void
  onCancel: (id: string) => void
}

const formatINR = (n: number) => formatINRBase(n, 0)

export default function PurchaseOrdersMobileList({
  pos,
  statusBadge,
  sendingEmailId,
  onView,
  onSend,
  onReceive,
  onSendEmail,
  onCancel,
}: Props) {
  const router = useRouter()
  const canWrite = useCanWrite('inventory')
  const [active, setActive] = useState<PO | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)

  function buildActions(po: PO): MobileAction[] {
    const actions: MobileAction[] = [
      {
        key: 'view',
        label: 'View purchase order',
        onSelect: () => {
          setActive(null)
          onView(po.id)
        },
      },
      {
        key: 'supplier',
        label: 'View supplier',
        onSelect: () => router.push(ap(`/admin/suppliers/${po.supplier_id}`)),
      },
    ]
    if (canWrite) {
      if (po.status === 'draft') {
        actions.push({ key: 'send', label: 'Mark as sent', onSelect: () => onSend(po.id) })
      }
      if (['sent', 'partial'].includes(po.status)) {
        actions.push({
          key: 'receive',
          label: 'Record receipt',
          onSelect: () => {
            setActive(null)
            onReceive(po.id)
          },
        })
      }
      if (po.supplier_email) {
        actions.push({
          key: 'email',
          label: sendingEmailId === po.id ? 'Sending email...' : 'Email supplier',
          disabled: sendingEmailId === po.id,
          onSelect: () => onSendEmail(po),
        })
      }
      if (po.status === 'draft') {
        actions.push({ key: 'cancel', label: 'Cancel PO', danger: true, onSelect: () => onCancel(po.id) })
      }
    }
    return actions
  }

  return (
    <>
      {pos.map(po => (
        <MobileListCard key={po.id} ariaLabel={`Open ${po.po_number}`} onTap={() => setActive(po)}>
          <div className="min-w-0 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono font-medium text-foreground text-sm truncate">{po.po_number}</span>
              <span
                className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium capitalize ${statusBadge[po.status] || ''}`}
              >
                {po.status}
              </span>
            </div>
            <div className="text-sm text-foreground truncate">{po.supplier_name}</div>
            <div className="flex items-center justify-between gap-2 text-xs text-foreground-secondary">
              <span>{formatDate(po.order_date)}</span>
              <span className="font-semibold text-foreground">{formatINR(parseFloat(po.total_amount))}</span>
            </div>
          </div>
        </MobileListCard>
      ))}

      <MobileDetailSheet
        open={!!active}
        onClose={() => setActive(null)}
        title={active?.po_number}
        subtitle={active?.supplier_name}
        footer={
          active && (
            <button
              type="button"
              onClick={() => setActionsOpen(true)}
              className="w-full bg-secondary-500 hover:bg-secondary-600 text-white text-sm font-semibold py-3 rounded-lg transition-colors"
            >
              Actions
            </button>
          )
        }
      >
        {active && (
          <div className="px-5 py-4 space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-foreground-secondary">Status</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${statusBadge[active.status] || ''}`}>
                {active.status}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-foreground-secondary">Order date</span>
              <span className="text-foreground">{formatDate(active.order_date)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-foreground-secondary">Expected</span>
              <span className="text-foreground">{active.expected_date ? formatDate(active.expected_date) : '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-foreground-secondary">Items</span>
              <span className="text-foreground">{active.item_count}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-foreground-secondary">Total</span>
              <span className="text-foreground font-semibold">{formatINR(parseFloat(active.total_amount))}</span>
            </div>
          </div>
        )}
      </MobileDetailSheet>

      <MobileActionSheet
        open={actionsOpen && !!active}
        onClose={() => setActionsOpen(false)}
        title={active?.po_number}
        actions={active ? buildActions(active) : []}
      />
    </>
  )
}
