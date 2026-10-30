'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, FileText, Printer, Truck } from 'lucide-react'
import { ap } from '@/lib/shared/admin-path'
import { useHasScope } from '@/contexts/AdminScopesContext'
import MobileListCard from '@/components/admin/mobile/MobileListCard'
import MobileDetailSheet from '@/components/admin/mobile/MobileDetailSheet'
import MobileActionSheet, { type MobileAction } from '@/components/admin/mobile/MobileActionSheet'
import SubscriptionOrderBadge from '@/components/admin/SubscriptionOrderBadge'
import { Badge, StatusBadge } from '@/components/admin/kit'
import { ORDER_STATUS_FULL, PAYMENT_STATUS_FULL, inr, sourceLabel, sourceTone } from './status-maps'

interface Props {
  orders: any[]
  backUrl: string
}

function customerName(order: any) {
  return order.users
    ? `${order.users.first_name || ''} ${order.users.last_name || ''}`.trim() || order.customer_name || 'Guest'
    : order.customer_name || 'Guest'
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  const title = typeof value === 'string' ? value : undefined
  return (
    <div className="min-w-0">
      <p className="text-xs text-foreground-muted">{label}</p>
      <p className="text-sm text-foreground font-medium break-all" title={title}>{value}</p>
    </div>
  )
}

export default function OrdersMobileList({ orders, backUrl }: Props) {
  const router = useRouter()
  const canPackingSlips = useHasScope('packing_slips:read')
  const [selected, setSelected] = useState<any>(null)
  const [actionsOpen, setActionsOpen] = useState(false)

  function buildActions(order: any): MobileAction[] {
    const actions: MobileAction[] = [
      {
        key: 'view',
        label: 'View full order',
        icon: <Eye className="w-4 h-4" />,
        onSelect: () => router.push(ap(`/admin/orders/${order.id}/view?back=${encodeURIComponent(backUrl)}`)),
      },
    ]
    if (canPackingSlips && order.status !== 'granted') {
      actions.push({
        key: 'packing',
        label: 'Packing slip',
        icon: <Printer className="w-4 h-4" />,
        onSelect: () => window.open(`/api/admin/packing-slips/${order.id}`, '_blank', 'noopener,noreferrer'),
      })
    }
    if (order.awb_number) {
      actions.push({
        key: 'label',
        label: 'Shipping label',
        icon: <Truck className="w-4 h-4" />,
        onSelect: () =>
          window.open(`/api/admin/orders/${order.id}/shipping-label?size=4R&print=1`, '_blank', 'noopener,noreferrer'),
      })
    }
    if (order.invoice_number) {
      actions.push({
        key: 'invoice',
        label: 'Invoice PDF',
        icon: <FileText className="w-4 h-4" />,
        onSelect: () => window.open(`/api/orders/${order.id}/invoice`, '_blank', 'noopener,noreferrer'),
      })
    }
    return actions
  }

  return (
    <div className="space-y-3">
      <>
          {orders.map((order: any) => (
            <MobileListCard
              key={order.id}
              ariaLabel={`Open order ${order.order_number || order.id.slice(0, 8)}`}
              onTap={() => setSelected(order)}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-semibold text-foreground truncate">
                    #{order.order_number || order.id.slice(0, 8)}
                  </span>
                  <Badge tone={sourceTone(order.source)}>{sourceLabel(order.source)}</Badge>
                  <SubscriptionOrderBadge subscriptionId={order.subscription_id} cycle={order.subscription_cycle} />
                </div>
                <span className="shrink-0">
                  <StatusBadge status={order.status} map={ORDER_STATUS_FULL} />
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-sm text-foreground truncate">{customerName(order)}</span>
                <span className="text-sm font-semibold tabular-nums text-foreground shrink-0">{inr(order.total_amount)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-foreground-muted">
                  {new Date(order.created_at).toLocaleDateString('en-IN')}
                </span>
                <StatusBadge status={order.payment_status} map={PAYMENT_STATUS_FULL} />
              </div>
            </MobileListCard>
          ))}

          <MobileDetailSheet
            open={!!selected}
            onClose={() => setSelected(null)}
            title={selected ? `#${selected.order_number || selected.id.slice(0, 8)}` : ''}
            subtitle={selected ? customerName(selected) : undefined}
            footer={
              <button
                type="button"
                onClick={() => setActionsOpen(true)}
                className="control-md w-full justify-center bg-accent-500 font-semibold text-white hover:bg-accent-600"
              >
                Actions
              </button>
            }
          >
            {selected && (
              <div className="p-5 space-y-4">
                <div className="flex flex-wrap gap-2">
                  <StatusBadge status={selected.status} map={ORDER_STATUS_FULL} />
                  <StatusBadge status={selected.payment_status} map={PAYMENT_STATUS_FULL} />
                  <Badge tone={sourceTone(selected.source)}>{sourceLabel(selected.source)}</Badge>
                </div>
                <div>
                  <p className="text-xs text-foreground-muted uppercase tracking-wide mb-1">Total</p>
                  <p className="text-xl font-bold tabular-nums text-foreground">{inr(selected.total_amount)}</p>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border-default pt-4">
                  <Field label="Customer" value={customerName(selected)} />
                  <Field label="Contact" value={selected.users?.email || selected.billing_email || '—'} />
                  <Field label="Date" value={new Date(selected.created_at).toLocaleDateString('en-IN')} />
                  <Field
                    label="EDD"
                    value={
                      selected.estimated_delivery_date
                        ? new Date(selected.estimated_delivery_date).toLocaleDateString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })
                        : '—'
                    }
                  />
                  <Field label="AWB" value={selected.awb_number || '—'} />
                  <Field label="Invoice" value={selected.invoice_number || '—'} />
                </div>
              </div>
            )}
          </MobileDetailSheet>

          <MobileActionSheet
            open={actionsOpen && !!selected}
            onClose={() => setActionsOpen(false)}
            title={selected ? `#${selected.order_number || selected.id.slice(0, 8)}` : undefined}
            actions={selected ? buildActions(selected) : []}
          />
      </>
    </div>
  )
}
