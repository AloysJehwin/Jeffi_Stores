'use client'

import { DataTable, StatusBadge, humanize, type DataCol, type InfiniteControl } from '@/components/admin/kit'
import type { LedgerEntry, TenantTransaction } from '@/lib/tenant-registry/tenants'
import type { WalletLedgerEntry } from '@/lib/payments/wallet'
import { MONEY_STATUS, inr as inrBase } from '../cells'

// Transactions, settlement ledger and wallet ledger for the Billing page and the Commerce tab. One page of rows
// each; the page renders a Pager under them, so the footer only counts.

const inr = (n: number | string) => inrBase(n, 2)
const day = (v: string) => new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const signTone = (v: number) => (v >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400')
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${inr(Math.abs(v))}`
const counted = (total: number): InfiniteControl & { loading?: boolean } => ({ total, hasMore: false, loadingMore: false, loadMore: () => {} })

export const LEDGER_LABEL: Record<string, string> = {
  order_capture: 'Order capture (tenant share)',
  commission: 'Platform commission',
  gateway_fee: 'Gateway fee',
  subscription_charge: 'Subscription charge',
  cod_remittance: 'COD remittance',
  delhivery_correction: 'Delhivery charge correction',
  refund: 'Refund',
  payout: 'Payout to tenant',
  adjustment: 'Adjustment',
}

const WALLET_LABEL: Record<string, string> = {
  shipping_forward: 'Shipping',
  shipping_rvp: 'Return pickup',
  shipping_correction: 'Shipping correction',
  shipping_cancel_credit: 'Cancelled shipment credit',
  recharge: 'Top-up',
  goodwill_credit: 'Platform credit',
  ai: 'AI',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  email: 'Email',
  ad_free: 'Ad-free',
  infra: 'Servers',
}
export const walletLabel = (e: Pick<WalletLedgerEntry, 'category' | 'entry_type'>) => WALLET_LABEL[e.category ?? ''] ?? humanize(e.category || e.entry_type)

const Mode = ({ tx }: { tx: TenantTransaction }) => <span className="text-foreground-secondary">{tx.is_cod ? 'COD' : 'Prepaid'}</span>

const TX_COLS: DataCol<TenantTransaction>[] = [
  { key: 'order', label: 'Order', sort: tx => tx.order_ref || '', render: tx => <span className="font-medium text-foreground">{tx.order_ref || '-'}</span> },
  { key: 'gross', label: 'Gross', num: true, sort: tx => Number(tx.gross_amount) || 0, render: tx => inr(tx.gross_amount) },
  { key: 'share', label: 'Tenant share', num: true, hideBelow: 'lg', sort: tx => Number(tx.tenant_share) || 0, render: tx => <span className="text-green-600 dark:text-green-400">{inr(tx.tenant_share)}</span> },
  { key: 'commission', label: 'Commission', num: true, sort: tx => Number(tx.platform_commission) || 0, render: tx => <span className="text-accent-600">{inr(tx.platform_commission)}</span> },
  { key: 'fee', label: 'Gateway fee', num: true, hideBelow: 'lg', sort: tx => Number(tx.gateway_fee) || 0, render: tx => <span className="text-foreground-muted">{inr(tx.gateway_fee)}</span> },
  { key: 'mode', label: 'Mode', sort: tx => (tx.is_cod ? 'COD' : 'Prepaid'), render: tx => <Mode tx={tx} /> },
  { key: 'status', label: 'Status', sort: tx => tx.status, render: tx => <StatusBadge status={tx.status} map={MONEY_STATUS} /> },
  { key: 'date', label: 'Date', sortType: 'date', sort: tx => new Date(tx.occurred_at).getTime(), render: tx => <span className="text-foreground-muted">{day(tx.occurred_at)}</span> },
]

export function TransactionsTable({ rows, total }: { rows: TenantTransaction[]; total: number }) {
  return (
    <DataTable
      sortNs="tx"
      rows={rows}
      cols={TX_COLS}
      rowKey={tx => tx.id}
      infinite={counted(total)}
      noun="transactions"
      empty="No transactions yet."
      bare
      mobileCard={tx => (
        <div className="rounded-xl border border-border-default bg-surface-elevated p-3 space-y-1.5 min-w-0">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <span className="text-sm font-medium text-foreground min-w-0 break-all">{tx.order_ref || '-'}</span>
            <StatusBadge status={tx.status} map={MONEY_STATUS} />
          </div>
          <div className="flex justify-between gap-2 text-xs text-foreground-muted">
            <span>
              {tx.is_cod ? 'COD' : 'Prepaid'} · {day(tx.occurred_at)}
            </span>
            <span className="font-semibold text-foreground tabular-nums">{inr(tx.gross_amount)}</span>
          </div>
          <div className="flex justify-between gap-2 text-xs text-foreground-muted tabular-nums">
            <span>Commission {inr(tx.platform_commission)}</span>
            <span>Fee {inr(tx.gateway_fee)}</span>
          </div>
        </div>
      )}
    />
  )
}

const LEDGER_COLS: DataCol<LedgerEntry>[] = [
  { key: 'entry', label: 'Entry', sort: e => LEDGER_LABEL[e.entry_type] || e.entry_type, render: e => LEDGER_LABEL[e.entry_type] || humanize(e.entry_type) },
  { key: 'note', label: 'Note', hideBelow: 'lg', sort: e => e.note || '', className: 'max-w-xs truncate', render: e => <span className="text-foreground-muted">{e.note || '-'}</span> },
  { key: 'amount', label: 'Amount', num: true, sort: e => Number(e.amount), render: e => <span className={`font-medium ${signTone(Number(e.amount))}`}>{signed(Number(e.amount))}</span> },
  { key: 'date', label: 'Date', sortType: 'date', sort: e => new Date(e.occurred_at).getTime(), render: e => <span className="text-foreground-muted">{day(e.occurred_at)}</span> },
]

export function LedgerTable({ rows, total, balance }: { rows: LedgerEntry[]; total: number; balance: number }) {
  return (
    <div className="space-y-3 min-w-0">
      <DataTable
        sortNs="ledger"
        rows={rows}
        cols={LEDGER_COLS}
        rowKey={e => e.id}
        infinite={counted(total)}
        noun="entries"
        empty="No ledger entries yet."
        bare
        mobileCard={e => (
          <div className="rounded-xl border border-border-default bg-surface-elevated p-3 space-y-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground min-w-0 break-words">{LEDGER_LABEL[e.entry_type] || humanize(e.entry_type)}</span>
              <span className={`shrink-0 font-semibold tabular-nums ${signTone(Number(e.amount))}`}>{signed(Number(e.amount))}</span>
            </div>
            <div className="text-xs text-foreground-muted">{day(e.occurred_at)}</div>
            {e.note && <div className="text-xs text-foreground-muted break-words">{e.note}</div>}
          </div>
        )}
      />
      <div className="flex items-center justify-between border-t border-border-default pt-3 text-sm font-semibold">
        <span className="text-foreground">Balance</span>
        <span className={`tabular-nums ${signTone(balance)}`}>{inr(balance)}</span>
      </div>
    </div>
  )
}

type WalletRow = WalletLedgerEntry & { k: string }

const WALLET_COLS: DataCol<WalletRow>[] = [
  { key: 'type', label: 'Type', sort: e => walletLabel(e), render: e => walletLabel(e) },
  { key: 'ref', label: 'Order / AWB', hideBelow: 'lg', sort: e => e.order_ref || e.awb || '', render: e => <span className="font-mono text-xs text-foreground-secondary">{[e.order_ref, e.awb].filter(Boolean).join(' · ') || '-'}</span> },
  { key: 'note', label: 'Note', hideBelow: 'xl', className: 'max-w-xs truncate', sort: e => e.note || '', render: e => <span className="text-foreground-muted">{e.note || '-'}</span> },
  { key: 'amount', label: 'Amount', num: true, sort: e => Number(e.amount), render: e => <span className={`font-medium ${signTone(Number(e.amount))}`}>{signed(Number(e.amount))}</span> },
  { key: 'date', label: 'Date', sortType: 'date', sort: e => new Date(e.occurred_at).getTime(), render: e => <span className="text-foreground-muted">{day(e.occurred_at)}</span> },
]

/** The wallet's latest movements; there is no offset paging, so the page asks for more rows. */
export function WalletTable({ rows }: { rows: WalletLedgerEntry[] }) {
  const keyed = rows.map((r, i) => ({ ...r, k: `${r.occurred_at}-${r.awb ?? ''}-${i}` }))
  return (
    <DataTable
      sortNs="wallet"
      rows={keyed}
      cols={WALLET_COLS}
      rowKey={e => e.k}
      pageSize={Math.max(25, rows.length)}
      noun="movements"
      empty="No wallet movements yet."
      bare
      mobileCard={e => (
        <div className="rounded-xl border border-border-default bg-surface-elevated p-3 space-y-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-foreground min-w-0 break-words">{walletLabel(e)}</span>
            <span className={`shrink-0 font-semibold tabular-nums ${signTone(Number(e.amount))}`}>{signed(Number(e.amount))}</span>
          </div>
          <div className="text-xs text-foreground-muted break-all">
            {day(e.occurred_at)}
            {(e.order_ref || e.awb) && ` · ${[e.order_ref, e.awb].filter(Boolean).join(' · ')}`}
          </div>
          {e.note && <div className="text-xs text-foreground-muted break-words">{e.note}</div>}
        </div>
      )}
    />
  )
}
