'use client'

import { useState } from 'react'
import { ap } from '@/lib/shared/admin-path'
import MobileListCard from '@/components/admin/mobile/MobileListCard'
import MobileDetailSheet from '@/components/admin/mobile/MobileDetailSheet'
import MobileActionSheet, { type MobileAction } from '@/components/admin/mobile/MobileActionSheet'

interface CashSale {
  id: string
  order_number: string
  invoice_number: string | null
  invoice_date: string
  customer_name: string
  total_amount: string
  taxable_amount: string
  cgst_amount: string
  sgst_amount: string
  igst_amount: string
  payment_status: string
  status: string
  notes: string | null
  pdf_url: string | null
}

interface Props {
  sales: CashSale[]
  canWrite: boolean
  cancellingId: string | null
  paymentColors: Record<string, string>
  onCancel: (id: string) => void | Promise<void>
}

function fmt(n: number) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2 })
}

function fmtDate(s: string) {
  if (!s) return ''
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function CashSaleMobileList({ sales, canWrite, cancellingId, paymentColors, onCancel }: Props) {
  const [active, setActive] = useState<CashSale | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)

  function buildActions(sale: CashSale): MobileAction[] {
    const actions: MobileAction[] = [
      {
        key: 'pdf',
        label: 'Download receipt PDF',
        onSelect: () => {
          window.open(`/api/admin/cash-sale/${sale.id}/receipt`, '_blank', 'noreferrer')
        },
      },
      {
        key: 'detail',
        label: 'View detail',
        onSelect: () => {
          window.location.href = ap(`/admin/cash-sale/${sale.id}`)
        },
      },
    ]
    if (sale.status !== 'cancelled' && canWrite) {
      actions.push({
        key: 'cancel',
        label: cancellingId === sale.id ? 'Cancelling...' : 'Cancel sale',
        danger: true,
        disabled: cancellingId === sale.id,
        onSelect: () => {
          setActive(null)
          onCancel(sale.id)
        },
      })
    }
    return actions
  }

  return (
    <>
      {sales.map(sale => (
        <MobileListCard
          key={sale.id}
          ariaLabel={`Open sale ${sale.invoice_number || sale.order_number}`}
          onTap={() => setActive(sale)}
        >
          <div className="min-w-0 space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="font-mono font-semibold text-sm text-foreground truncate block">
                  {sale.invoice_number || '-'}
                </span>
                <span className="text-xs text-foreground-muted font-mono">{sale.order_number}</span>
              </div>
              <span className="shrink-0 font-semibold text-foreground text-sm">
                &#8377;{fmt(parseFloat(sale.total_amount))}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-foreground">Walk-in Customer</span>
              <span className="text-xs text-foreground-muted shrink-0">{fmtDate(sale.invoice_date)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${paymentColors[sale.payment_status] || ''}`}>
                {sale.payment_status}
              </span>
              {sale.status === 'cancelled' && (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                  Cancelled
                </span>
              )}
            </div>
          </div>
        </MobileListCard>
      ))}

      <MobileDetailSheet
        open={!!active}
        onClose={() => setActive(null)}
        title={active ? active.invoice_number || active.order_number : ''}
        subtitle={active ? fmtDate(active.invoice_date) : undefined}
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
            <div className="flex flex-wrap gap-2">
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${paymentColors[active.payment_status] || ''}`}>
                {active.payment_status}
              </span>
              {active.status === 'cancelled' && (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                  Cancelled
                </span>
              )}
            </div>
            <div className="flex justify-between">
              <span className="text-foreground-secondary">Order</span>
              <span className="text-foreground font-mono">{active.order_number}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-foreground-secondary">Customer</span>
              <span className="text-foreground font-medium">Walk-in Customer</span>
            </div>
            {parseFloat(active.taxable_amount) > 0 && (
              <div className="flex justify-between">
                <span className="text-foreground-secondary">Taxable</span>
                <span className="text-foreground">&#8377;{fmt(parseFloat(active.taxable_amount))}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-foreground-secondary">Total</span>
              <span className="text-foreground font-semibold">&#8377;{fmt(parseFloat(active.total_amount))}</span>
            </div>
            {active.notes && (
              <div className="border-t border-border-default pt-3">
                <p className="text-xs text-foreground-muted uppercase tracking-wide mb-1">Notes</p>
                <p className="text-foreground">{active.notes}</p>
              </div>
            )}
          </div>
        )}
      </MobileDetailSheet>

      <MobileActionSheet
        open={actionsOpen && !!active}
        onClose={() => setActionsOpen(false)}
        title={active ? active.invoice_number || active.order_number : undefined}
        actions={active ? buildActions(active) : []}
      />
    </>
  )
}
