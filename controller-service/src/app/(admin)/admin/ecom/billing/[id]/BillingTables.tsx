'use client'

import { DataTable, type DataCol } from '@/components/admin/kit'
import { StatusPill } from '@/components/admin/ecom/EcomUI'
import type { LedgerEntry, TenantTransaction } from '@/lib/tenant-registry/tenants'

// Client table wrappers for the billing detail page.

const inr = (n: number | string) => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const day = (v: string) => new Date(v).toLocaleDateString('en-IN')
const signTone = (v: number) => (v >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400')

const TX_COLS: DataCol<TenantTransaction>[] = [
  { key: 'order', label: 'Order', render: tx => <span className="font-medium text-foreground">{tx.order_ref || '-'}</span> },
  { key: 'gross', label: 'Gross', num: true, render: tx => inr(tx.gross_amount) },
  { key: 'share', label: 'Tenant share', num: true, render: tx => <span className="text-green-600 dark:text-green-400">{inr(tx.tenant_share)}</span> },
  { key: 'commission', label: 'Commission', num: true, render: tx => <span className="text-accent-600">{inr(tx.platform_commission)}</span> },
  { key: 'fee', label: 'Gateway fee', num: true, render: tx => <span className="text-foreground-muted">{inr(tx.gateway_fee)}</span> },
  { key: 'mode', label: 'Mode', render: tx => <span className="text-foreground-secondary">{tx.is_cod ? 'COD' : 'Prepaid'}</span> },
  { key: 'status', label: 'Status', render: tx => <StatusPill status={tx.status} /> },
  { key: 'date', label: 'Date', render: tx => <span className="text-foreground-muted">{day(tx.occurred_at)}</span> },
]

export function TransactionsTable({ rows }: { rows: TenantTransaction[] }) {
  return (
    <DataTable
      rows={rows}
      cols={TX_COLS}
      rowKey={tx => tx.id}
      empty="No transactions yet."
      bare
      mobileCard={tx => (
        <div className="rounded-xl border border-border-default bg-surface-elevated p-3 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-foreground">{tx.order_ref || '-'}</span>
            <StatusPill status={tx.status} />
          </div>
          <div className="flex justify-between text-xs text-foreground-muted">
            <span>{tx.is_cod ? 'COD' : 'Prepaid'} · {day(tx.occurred_at)}</span>
            <span className="font-semibold text-foreground tabular-nums">{inr(tx.gross_amount)}</span>
          </div>
        </div>
      )}
    />
  )
}

export function LedgerTable({ rows, labels, balance }: { rows: LedgerEntry[]; labels: Record<string, string>; balance: number }) {
  const cols: DataCol<LedgerEntry>[] = [
    { key: 'entry', label: 'Entry', render: e => labels[e.entry_type] || e.entry_type },
    { key: 'note', label: 'Note', render: e => <span className="text-foreground-muted">{e.note || '-'}</span> },
    {
      key: 'amount',
      label: 'Amount',
      num: true,
      render: e => {
        const amt = Number(e.amount)
        return (
          <span className={`font-medium ${signTone(amt)}`}>
            {amt >= 0 ? '+' : '−'}
            {inr(Math.abs(amt))}
          </span>
        )
      },
    },
    { key: 'date', label: 'Date', render: e => <span className="text-foreground-muted">{day(e.occurred_at)}</span> },
  ]
  return (
    <div className="space-y-3">
      <DataTable
        rows={rows}
        cols={cols}
        rowKey={e => e.id}
        empty="No ledger entries yet."
        bare
        mobileCard={e => {
          const amt = Number(e.amount)
          return (
            <div className="rounded-xl border border-border-default bg-surface-elevated p-3 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">{labels[e.entry_type] || e.entry_type}</span>
                <span className={`font-semibold tabular-nums ${signTone(amt)}`}>
                  {amt >= 0 ? '+' : '−'}
                  {inr(Math.abs(amt))}
                </span>
              </div>
              <div className="text-xs text-foreground-muted">{day(e.occurred_at)}</div>
              {e.note && <div className="text-xs text-foreground-muted">{e.note}</div>}
            </div>
          )
        }}
      />
      <div className="flex items-center justify-between border-t border-border-default pt-3 text-sm font-semibold">
        <span className="text-foreground">Balance</span>
        <span className={`tabular-nums ${signTone(balance)}`}>{inr(balance)}</span>
      </div>
    </div>
  )
}
