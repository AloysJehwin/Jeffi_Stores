'use client'

import { useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { DataTable, StatusBadge, humanize, type DataCol, type PagerControl, type StatusMap } from '@/components/admin/kit'
import type { LedgerEntry, TenantTransaction } from '@/lib/tenant-registry/tenants'
import type { WalletLedgerEntry } from '@/lib/payments/wallet'
import type { OverviewLine } from '@controller/lib/billing/overview'
import type { TenantBillingCharge } from '@controller/lib/overviews/ecom-billing'
import { MONEY_STATUS, inr as inrBase } from '../cells'

// Transactions, settlement ledger, wallet ledger and the workspace subscription's lines and charges for the Billing
// page and the Commerce tab. Each paged table gets one server page of rows; its ‹ › arrows change that table's page
// param (?tp, ?lp, ?wp, ?cp) in the URL.

const inr = (n: number | string) => inrBase(n, 2)
const day = (v: string) => new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const signTone = (v: number) => (v >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400')
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${inr(Math.abs(v))}`
/** Which page of a server-paged table this is, and the query param that holds it. */
export interface TablePage {
  page: number
  pageSize: number
  param: string
}

function useUrlPager({ page, pageSize, param }: TablePage, total: number | null, hasNext = total != null && page * pageSize < total): PagerControl {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [loading, start] = useTransition()
  return {
    page,
    pageSize,
    total,
    hasNext,
    loading,
    setPage: n => {
      const q = new URLSearchParams(params.toString())
      if (n > 1) q.set(param, String(n))
      else q.delete(param)
      const qs = q.toString()
      start(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }))
    },
  }
}

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
  messaging_addon: 'SMS & WhatsApp add-on',
  domain: 'Domain',
  infra: 'Servers',
  showcase: 'Showcase site',
  campaign: 'Campaign',
  media: 'Media',
  adjustment: 'Adjustment',
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

export function TransactionsTable({ rows, total, paging }: { rows: TenantTransaction[]; total: number; paging: TablePage }) {
  const pager = useUrlPager(paging, total)
  return (
    <DataTable
      sortNs="tx"
      rows={rows}
      cols={TX_COLS}
      rowKey={tx => tx.id}
      pager={pager}
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

export function LedgerTable({ rows, total, balance, paging }: { rows: LedgerEntry[]; total: number; balance: number; paging: TablePage }) {
  const pager = useUrlPager(paging, total)
  return (
    <div className="space-y-3 min-w-0">
      <DataTable
        sortNs="ledger"
        rows={rows}
        cols={LEDGER_COLS}
        rowKey={e => e.id}
        pager={pager}
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

/** One page of the wallet's movements; its total is not counted, so `hasNext` comes from the page. */
export function WalletTable({ rows, paging, hasNext }: { rows: WalletLedgerEntry[]; paging: TablePage; hasNext: boolean }) {
  const pager = useUrlPager(paging, null, hasNext)
  const keyed = rows.map((r, i) => ({ ...r, k: `${r.occurred_at}-${r.awb ?? ''}-${i}` }))
  return (
    <DataTable
      sortNs="wallet"
      rows={keyed}
      cols={WALLET_COLS}
      rowKey={e => e.k}
      pager={pager}
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

// ── Workspace subscription (lib/billing) ─────────────────────────────────────

const SUBSCRIPTION_STATUS: StatusMap = {
  created: { label: 'Not paid yet', tone: 'amber' },
  authenticated: { label: 'Authorised', tone: 'blue' },
  active: { label: 'Active', tone: 'green' },
  pending: { label: 'Retrying payment', tone: 'amber' },
  halted: { label: 'Payment failed', tone: 'red' },
  paused: { label: 'Paused', tone: 'muted' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
  completed: { label: 'Completed', tone: 'muted' },
  expired: { label: 'Expired', tone: 'muted' },
  superseded: { label: 'Replaced', tone: 'muted' },
  abandoned: { label: 'Abandoned', tone: 'muted' },
}

const LINE_STATUS: StatusMap = {
  trial: { label: 'Trial', tone: 'blue' },
  awaiting_payment: { label: 'Awaiting payment', tone: 'amber' },
  active: { label: 'Active', tone: 'green' },
  ending: { label: 'Ending', tone: 'amber' },
  legacy_wallet: { label: 'Wallet (legacy)', tone: 'muted' },
  ended: { label: 'Ended', tone: 'muted' },
}

export const LINE_KIND_LABEL: Record<string, string> = {
  store_plan: 'Store plan',
  showcase_site: 'Showcase site',
  messaging_addon: 'SMS & WhatsApp add-on',
  ad_free: 'Ad-free store',
  other: 'Unassigned',
}

export function SubscriptionBadge({ status }: { status: string | null | undefined }) {
  return <StatusBadge status={status} map={SUBSCRIPTION_STATUS} />
}

const rupees = (paise: number) => inr(paise / 100)

/** The date that matters next for a line: its trial end, its end, or the end of its grace. */
function lineUntil(l: OverviewLine): string {
  if (l.graceUntil) return `Grace until ${day(l.graceUntil)}`
  if (l.status === 'trial' && l.trialEndsAt) return `Trial ends ${day(l.trialEndsAt)}`
  if (l.endsAt) return `Ends ${day(l.endsAt)}`
  return '-'
}

const lineSub = (l: OverviewLine) => [LINE_KIND_LABEL[l.kind] ?? humanize(l.kind), l.kind === 'messaging_addon' && l.ref ? humanize(l.ref) : null].filter(Boolean).join(' · ')
const linePrice = (l: OverviewLine) => (
  <span className="tabular-nums">
    {rupees(l.amountPaise)}
    {l.nextAmountPaise != null && l.changesAt && (
      <span className="block text-xs text-foreground-muted">
        {rupees(l.nextAmountPaise)} from {day(l.changesAt)}
      </span>
    )}
  </span>
)

const LINE_COLS: DataCol<OverviewLine>[] = [
  {
    key: 'line',
    label: 'Line',
    sort: l => l.label,
    render: l => (
      <div className="min-w-0">
        <p className="font-medium text-foreground break-words">{l.label}</p>
        <p className="text-xs text-foreground-muted">{lineSub(l)}</p>
      </div>
    ),
  },
  { key: 'status', label: 'Status', sort: l => l.status, render: l => <StatusBadge status={l.status} map={LINE_STATUS} /> },
  { key: 'monthly', label: 'Monthly', num: true, sort: l => l.amountPaise, render: linePrice },
  { key: 'until', label: 'Next date', hideBelow: 'lg', sort: l => l.graceUntil || l.trialEndsAt || l.endsAt || '', render: l => <span className="text-foreground-muted">{lineUntil(l)}</span> },
]

/** What the workspace is billed for (its open billing lines). */
export function BillingLinesTable({ rows }: { rows: OverviewLine[] }) {
  return (
    <DataTable
      sortNs="lines"
      rows={rows}
      cols={LINE_COLS}
      rowKey={l => l.id}
      noun="lines"
      empty="Nothing on the subscription yet."
      bare
      mobileCard={l => (
        <div className="rounded-xl border border-border-default bg-surface-elevated p-3 space-y-1.5 min-w-0">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <span className="text-sm font-medium text-foreground min-w-0 break-words">{l.label}</span>
            <StatusBadge status={l.status} map={LINE_STATUS} />
          </div>
          <div className="flex justify-between gap-2 text-xs text-foreground-muted">
            <span>{lineUntil(l)}</span>
            <span className="font-semibold text-foreground tabular-nums">{rupees(l.amountPaise)}/mo</span>
          </div>
        </div>
      )}
    />
  )
}

const chargeFor = (c: TenantBillingCharge) => c.lines.map(l => l.label || LINE_KIND_LABEL[l.kind] || l.kind).join(', ') || 'Subscription'
const chargePeriod = (c: TenantBillingCharge) => (c.periodStart && c.periodEnd ? `${day(c.periodStart)} – ${day(c.periodEnd)}` : '-')

const CHARGE_COLS: DataCol<TenantBillingCharge>[] = [
  { key: 'date', label: 'Charged', sortType: 'date', sort: c => new Date(c.chargedAt).getTime(), render: c => <span className="text-foreground-muted">{day(c.chargedAt)}</span> },
  { key: 'for', label: 'For', sort: c => chargeFor(c), className: 'max-w-xs truncate', render: c => <span className="text-foreground">{chargeFor(c)}</span> },
  { key: 'period', label: 'Period', hideBelow: 'lg', sort: c => c.periodStart || '', render: c => <span className="text-foreground-muted">{chargePeriod(c)}</span> },
  { key: 'amount', label: 'Amount', num: true, sort: c => c.amountPaise, render: c => <span className="font-medium text-foreground">{inr(c.amountPaise / 100)}</span> },
  {
    key: 'refunded',
    label: 'Refunded',
    num: true,
    hideBelow: 'lg',
    sort: c => c.refundedPaise,
    render: c => (c.refundedPaise > 0 ? <span className="text-red-600 dark:text-red-400">−{inr(c.refundedPaise / 100)}</span> : <span className="text-foreground-muted">-</span>),
  },
  { key: 'payment', label: 'Payment', hideBelow: 'xl', sort: c => c.paymentId, render: c => <span className="font-mono text-xs text-foreground-secondary">{c.paymentId}</span> },
]

/** Successful charges of the workspace subscription, one server page at a time (?cp). */
export function BillingChargesTable({ rows, total, paging }: { rows: TenantBillingCharge[]; total: number; paging: TablePage }) {
  const pager = useUrlPager(paging, total)
  return (
    <DataTable
      sortNs="charges"
      rows={rows}
      cols={CHARGE_COLS}
      rowKey={c => c.id}
      pager={pager}
      noun="charges"
      empty="No subscription charges yet."
      bare
      mobileCard={c => (
        <div className="rounded-xl border border-border-default bg-surface-elevated p-3 space-y-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-foreground min-w-0 break-words">{chargeFor(c)}</span>
            <span className="shrink-0 font-semibold tabular-nums text-foreground">{inr(c.amountPaise / 100)}</span>
          </div>
          <div className="text-xs text-foreground-muted">
            {day(c.chargedAt)}
            {c.periodStart && c.periodEnd && ` · ${chargePeriod(c)}`}
          </div>
          {c.refundedPaise > 0 && <div className="text-xs text-red-600 dark:text-red-400">Refunded {inr(c.refundedPaise / 100)}</div>}
          <div className="font-mono text-xs text-foreground-muted break-all">{c.paymentId}</div>
        </div>
      )}
    />
  )
}
