'use client'

import { useState } from 'react'
import { ap } from '@/lib/shared/admin-path'
import MobileListCard from '@/components/admin/mobile/MobileListCard'
import MobileDetailSheet from '@/components/admin/mobile/MobileDetailSheet'
import MobileActionSheet, { type MobileAction } from '@/components/admin/mobile/MobileActionSheet'
import { formatDate, formatINR } from './shared'

interface CodOrder {
  id: string
  order_number: string
  customer_name: string
  total_amount: string
  payment_status?: string
  delivered_at?: string | null
  cod_remitted_at?: string | null
}

interface Props {
  orders: CodOrder[]
  canWrite: boolean
  selected: Set<string>
  onToggle: (id: string) => void
  onMarkRemitted: (ids: string[]) => void | Promise<void>
  marking: boolean
}

function statusLabel(s?: string) {
  if (s === 'cod_pending') return 'Pending'
  if (s === 'cod_collected') return 'Collected'
  if (s === 'paid') return 'Remitted'
  return s || '-'
}

function statusClass(s?: string) {
  if (s === 'cod_pending') return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
  if (s === 'cod_collected') return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
  return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
}

export default function CodRemittanceMobileList({
  orders,
  canWrite,
  selected,
  onToggle,
  onMarkRemitted,
  marking,
}: Props) {
  const [active, setActive] = useState<CodOrder | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)

  function buildActions(order: CodOrder): MobileAction[] {
    const actions: MobileAction[] = [
      {
        key: 'order',
        label: 'View order',
        onSelect: () => {
          window.location.href = ap(`/admin/orders/${order.id}`)
        },
      },
    ]
    if (canWrite && order.payment_status !== 'paid') {
      actions.push({
        key: 'remit',
        label: 'Mark as remitted',
        disabled: marking,
        onSelect: () => {
          setActive(null)
          onMarkRemitted([order.id])
        },
      })
      actions.push({
        key: 'select',
        label: selected.has(order.id) ? 'Deselect for bulk' : 'Select for bulk remit',
        onSelect: () => onToggle(order.id),
      })
    }
    return actions
  }

  return (
    <>
      {orders.map(order => (
        <MobileListCard
          key={order.id}
          accent={selected.has(order.id)}
          ariaLabel={`Open order ${order.order_number}`}
          onTap={() => setActive(order)}
        >
          <div className="flex items-start gap-2">
            {canWrite && order.payment_status !== 'paid' && (
              <input
                type="checkbox"
                checked={selected.has(order.id)}
                onChange={() => onToggle(order.id)}
                onClick={e => e.stopPropagation()}
                className="mt-0.5 rounded border-border-default accent-secondary-500"
                aria-label={`Select order ${order.order_number}`}
              />
            )}
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono font-medium text-foreground text-sm truncate">#{order.order_number}</span>
                <span className="shrink-0 font-semibold text-foreground text-sm">
                  {formatINR(parseFloat(order.total_amount))}
                </span>
              </div>
              <div className="text-sm text-foreground-secondary truncate">{order.customer_name}</div>
              {order.payment_status && (
                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusClass(order.payment_status)}`}>
                  {statusLabel(order.payment_status)}
                </span>
              )}
            </div>
          </div>
        </MobileListCard>
      ))}

      <MobileDetailSheet
        open={!!active}
        onClose={() => setActive(null)}
        title={active ? `#${active.order_number}` : ''}
        subtitle={active?.customer_name || undefined}
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
              <span className="text-foreground-secondary">Customer</span>
              <span className="text-foreground font-medium">{active.customer_name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-foreground-secondary">Amount</span>
              <span className="text-foreground font-semibold">{formatINR(parseFloat(active.total_amount))}</span>
            </div>
            {active.payment_status && (
              <div className="flex justify-between">
                <span className="text-foreground-secondary">Status</span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusClass(active.payment_status)}`}>
                  {statusLabel(active.payment_status)}
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-foreground-secondary">Delivered</span>
              <span className="text-foreground">{active.delivered_at ? formatDate(active.delivered_at) : '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-foreground-secondary">Remitted</span>
              <span className="text-foreground">{active.cod_remitted_at ? formatDate(active.cod_remitted_at) : '-'}</span>
            </div>
          </div>
        )}
      </MobileDetailSheet>

      <MobileActionSheet
        open={actionsOpen && !!active}
        onClose={() => setActionsOpen(false)}
        title={active ? `#${active.order_number}` : undefined}
        actions={active ? buildActions(active) : []}
      />
    </>
  )
}
