'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, FileText, Printer, Truck } from 'lucide-react'
import { ap } from '@/lib/shared/admin-path'
import { useHasScope } from '@/contexts/AdminScopesContext'
import MobileListCard from '@/components/admin/mobile/MobileListCard'
import MobileDetailSheet from '@/components/admin/mobile/MobileDetailSheet'
import MobileActionSheet, { type MobileAction } from '@/components/admin/mobile/MobileActionSheet'

interface Props {
  orders: any[]
  backUrl: string
  pagination: React.ReactNode
}

const SOURCE_LABEL: Record<string, string> = {
  online: 'Online',
  business: 'Business',
  cash_sale: 'Cash Sale',
}

function sourceLabel(source: string) {
  return SOURCE_LABEL[source] || 'Offline'
}

function sourceBadge(source: string) {
  if (source === 'online') return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
  if (source === 'business') return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
  return 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
}

function statusBadge(status: string) {
  if (status === 'delivered') return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
  if (status === 'processing' || status === 'shipped')
    return 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
  if (status === 'out_for_delivery') return 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300'
  if (status === 'cancelled') return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
  if (status === 'cancel_requested') return 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300'
  return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'
}

function statusLabel(status: string) {
  if (status === 'cancel_requested') return 'Cancel Req.'
  if (status === 'out_for_delivery') return 'Out for Delivery'
  return status
}

function paymentBadge(status: string) {
  if (status === 'paid') return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
  if (status === 'pending') return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'
  return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
}

function customerName(order: any) {
  return order.users
    ? `${order.users.first_name || ''} ${order.users.last_name || ''}`.trim() || order.customer_name || 'Guest'
    : order.customer_name || 'Guest'
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-foreground-muted">{label}</p>
      <p className="text-sm text-foreground font-medium">{value}</p>
    </div>
  )
}

export default function OrdersMobileList({ orders, backUrl, pagination }: Props) {
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
        onSelect: () => router.push(ap(`/admin/orders/${order.id}?back=${encodeURIComponent(backUrl)}`)),
      },
    ]
    if (canPackingSlips) {
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
          window.open(
            `/api/admin/orders/${order.id}/shipping-label?size=4R&print=1`,
            '_blank',
            'noopener,noreferrer'
          ),
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
    <div className="md:hidden space-y-3">
      {orders.length === 0 ? (
        <div className="bg-surface-elevated rounded-lg border border-border-default p-8 text-center text-foreground-muted">
          No orders found.
        </div>
      ) : (
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
                  <span className={`px-1.5 py-0.5 text-xs font-medium rounded ${sourceBadge(order.source)}`}>
                    {sourceLabel(order.source)}
                  </span>
                </div>
                <span className={`shrink-0 px-2 py-0.5 text-xs font-semibold rounded-full ${statusBadge(order.status)}`}>
                  {statusLabel(order.status)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-sm text-foreground truncate">{customerName(order)}</span>
                <span className="text-sm font-semibold text-foreground shrink-0">
                  Rs. {Number(order.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-foreground-muted">
                  {new Date(order.created_at).toLocaleDateString('en-IN')}
                </span>
                <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${paymentBadge(order.payment_status)}`}>
                  {order.payment_status}
                </span>
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
                className="w-full bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold py-3 rounded-lg transition-colors"
              >
                Actions
              </button>
            }
          >
            {selected && (
              <div className="p-5 space-y-4">
                <div className="flex flex-wrap gap-2">
                  <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${statusBadge(selected.status)}`}>
                    {statusLabel(selected.status)}
                  </span>
                  <span
                    className={`px-2 py-0.5 text-xs font-semibold rounded-full ${paymentBadge(selected.payment_status)}`}
                  >
                    {selected.payment_status}
                  </span>
                  <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${sourceBadge(selected.source)}`}>
                    {sourceLabel(selected.source)}
                  </span>
                </div>
                <div>
                  <p className="text-xs text-foreground-muted uppercase tracking-wide mb-1">Total</p>
                  <p className="text-xl font-bold text-primary-500">
                    Rs. {Number(selected.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </p>
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
      )}
      {pagination}
    </div>
  )
}
