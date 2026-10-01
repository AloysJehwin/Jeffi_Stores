'use client'

import { useState } from 'react'
import { ap } from '@/lib/shared/admin-path'
import MobileListCard from '@/components/admin/mobile/MobileListCard'
import MobileDetailSheet from '@/components/admin/mobile/MobileDetailSheet'
import MobileActionSheet, { type MobileAction } from '@/components/admin/mobile/MobileActionSheet'

interface EligibleOrder {
  id: string
  order_number: string
  awb_number: string
  status: string
  created_at: string
  customer_name: string
  city: string
  state: string
  postal_code: string
}

interface Props {
  orders: EligibleOrder[]
  selected: Set<string>
  onToggle: (id: string) => void
}

function placedAt(s: string) {
  return new Date(s).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  })
}

export default function EligibleOrdersMobileList({ orders, selected, onToggle }: Props) {
  const [active, setActive] = useState<EligibleOrder | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)

  function destination(o: EligibleOrder) {
    return [o.city, o.state, o.postal_code].filter(Boolean).join(', ')
  }

  function buildActions(order: EligibleOrder): MobileAction[] {
    return [
      {
        key: 'order',
        label: 'View order',
        onSelect: () => {
          window.location.href = ap(`/admin/orders/${order.id}`)
        },
      },
      {
        key: 'select',
        label: selected.has(order.id) ? 'Remove from pickup' : 'Include in pickup',
        onSelect: () => onToggle(order.id),
      },
    ]
  }

  return (
    <>
      {orders.map(order => (
        <MobileListCard
          key={order.id}
          accent={selected.has(order.id)}
          ariaLabel={`Open order ${order.order_number || order.id}`}
          onTap={() => setActive(order)}
        >
          <div className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={selected.has(order.id)}
              onChange={() => onToggle(order.id)}
              onClick={e => e.stopPropagation()}
              className="mt-0.5 w-4 h-4 rounded border-border-default accent-accent-500"
              aria-label={`Select order ${order.order_number || order.id}`}
            />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono font-medium text-accent-500 text-sm truncate">
                  #{order.order_number || order.id.slice(0, 8)}
                </span>
                <span className="shrink-0 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 capitalize">
                  {order.status}
                </span>
              </div>
              <div className="font-mono text-xs text-foreground">{order.awb_number}</div>
              <div className="text-sm text-foreground truncate">{order.customer_name}</div>
              <div className="text-xs text-foreground-secondary truncate">{destination(order)}</div>
            </div>
          </div>
        </MobileListCard>
      ))}

      <MobileDetailSheet
        open={!!active}
        onClose={() => setActive(null)}
        title={active ? `#${active.order_number || active.id.slice(0, 8)}` : ''}
        subtitle={active?.customer_name || undefined}
        footer={
          active && (
            <button
              type="button"
              onClick={() => setActionsOpen(true)}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-3 rounded-lg transition-colors"
            >
              Actions
            </button>
          )
        }
      >
        {active && (
          <div className="px-5 py-4 space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-foreground-secondary">AWB</span>
              <span className="text-foreground font-mono">{active.awb_number}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-foreground-secondary">Status</span>
              <span className="text-foreground capitalize">{active.status}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-foreground-secondary shrink-0">Destination</span>
              <span className="text-foreground text-right">{destination(active)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-foreground-secondary">Placed</span>
              <span className="text-foreground">{placedAt(active.created_at)}</span>
            </div>
          </div>
        )}
      </MobileDetailSheet>

      <MobileActionSheet
        open={actionsOpen && !!active}
        onClose={() => setActionsOpen(false)}
        title={active ? `#${active.order_number || active.id.slice(0, 8)}` : undefined}
        actions={active ? buildActions(active) : []}
      />
    </>
  )
}
