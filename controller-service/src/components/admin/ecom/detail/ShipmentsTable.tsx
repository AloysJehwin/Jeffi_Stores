'use client'

import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { DataTable, type DataCol } from '@/components/admin/kit'
import RowActions, { type RowAction } from '@/components/admin/RowActions'
import type { ShipmentRow } from '@controller/lib/orders/tenant-shipments-shared'
import ShipmentCorrection from '../tabs/ShipmentCorrection'

const num = (v: string | null) => (v == null ? null : Number(v))
const inr = (n: number | null) => (n == null ? '—' : `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`)

function Extra({ v }: { v: number | null }) {
  if (v == null) return <span className="text-foreground-muted">—</span>
  const cls = v > 0 ? 'text-red-600 dark:text-red-400' : v < 0 ? 'text-green-600 dark:text-green-400' : 'text-foreground-muted'
  return <span className={cls}>{(v >= 0 ? '+' : '−') + inr(Math.abs(v))}</span>
}

const COLS: DataCol<ShipmentRow>[] = [
  { key: 'order', label: 'Order', sort: s => s.order_number || '', render: s => <span className="font-medium text-foreground">{s.order_number || '—'}</span> },
  { key: 'awb', label: 'AWB', sort: s => s.awb_number || '', render: s => <span className="font-mono text-xs text-foreground-secondary">{s.awb_number}</span> },
  { key: 'mode', label: 'Mode', hideBelow: 'lg', sort: s => s.payment_mode || '', render: s => (s.payment_mode === 'cod' ? 'COD' : 'Prepaid') },
  { key: 'quoted', label: 'Quoted', num: true, sort: s => num(s.shipping_amount) ?? -1, render: s => inr(num(s.shipping_amount)) },
  { key: 'billed', label: 'Billed', num: true, sort: s => num(s.delhivery_billed_amount) ?? -1, render: s => inr(num(s.delhivery_billed_amount)) },
  { key: 'extra', label: 'Extra', num: true, sort: s => num(s.delhivery_extra_charge) ?? 0, render: s => <Extra v={num(s.delhivery_extra_charge)} /> },
  { key: 'status', label: 'Status', hideBelow: 'lg', sort: s => s.shipment_status || '', render: s => <span className="text-foreground-muted">{s.shipment_status || '—'}</span> },
]

/** Shipments with an AWB; on the platform Delhivery account each charge can be set or corrected. */
export default function ShipmentsTable({ tenantId, ownDelhivery, shipments }: { tenantId: string; ownDelhivery: boolean; shipments: ShipmentRow[] }) {
  const [editing, setEditing] = useState<ShipmentRow | null>(null)
  const actions = (s: ShipmentRow): RowAction[] => [
    { key: 'correct', label: s.delhivery_billed_at ? 'Correct charge' : 'Set charge', icon: Pencil, onSelect: () => setEditing(s), hidden: ownDelhivery || !s.awb_number },
  ]
  return (
    <>
      <DataTable
        sortNs="ship"
        rows={shipments}
        cols={COLS}
        rowKey={s => s.id}
        rowActions={ownDelhivery ? undefined : actions}
        noun="shipments"
        paged
        empty="No shipments with an AWB yet."
        mobileCard={s => (
          <div className="rounded-xl border border-border-default bg-surface-elevated p-3 space-y-1.5 min-w-0">
            <div className="flex items-start justify-between gap-2 min-w-0">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground break-words">{s.order_number || '—'}</p>
                <p className="font-mono text-xs text-foreground-muted break-all">{s.awb_number}</p>
              </div>
              {!ownDelhivery && <RowActions actions={actions(s)} />}
            </div>
            <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-foreground-muted tabular-nums">
              <span>{s.payment_mode === 'cod' ? 'COD' : 'Prepaid'}{s.shipment_status ? ` · ${s.shipment_status}` : ''}</span>
              <span>
                Quoted {inr(num(s.shipping_amount))} · Billed {inr(num(s.delhivery_billed_amount))} · <Extra v={num(s.delhivery_extra_charge)} />
              </span>
            </div>
          </div>
        )}
      />
      <ShipmentCorrection tenantId={tenantId} shipment={editing} onClose={() => setEditing(null)} />
    </>
  )
}
