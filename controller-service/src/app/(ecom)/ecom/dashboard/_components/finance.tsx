import type { ReactNode } from 'react'
import type { TenantTransaction, LedgerEntry, LinkedPayout } from '@/lib/tenant-registry'
import { aiLedgerNote } from '@/lib/ai/feature-labels'
import { StatTile } from './Card'

export const STATUS_PILL: Record<string, string> = {
  captured: 'org-sage org-sage-text',
  settled: 'bg-[var(--console-sage)] text-[var(--console-sage-deep)]',
  split: 'org-peach org-brown',
  refunded: 'bg-[#f2d4cd] text-[#8a2e1f]',
  failed: 'bg-[#f2d4cd] text-[#8a2e1f]',
}

const LEDGER_COLORS: Record<string, string> = {
  order_capture: 'org-sage-text',
  payout: 'text-[#8a2e1f]',
  commission: 'text-orange-500',
  gateway_fee: 'text-orange-400',
  subscription_charge: 'text-purple-600',
  refund: 'text-[#8a2e1f]',
  adjustment: 'text-foreground-secondary',
  cod_remittance: 'org-brown',
}

export function fmt(n: number) {
  return '₹' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
/** Like fmt, without ".00" on whole rupees (₹1,180; ₹1,234.12 keeps its paise). */
export function fmtWhole(n: number) {
  const a = Math.abs(n)
  return '₹' + a.toLocaleString('en-IN', { minimumFractionDigits: Math.round(a * 100) % 100 ? 2 : 0, maximumFractionDigits: 2 })
}
export function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const humanize = (s: string) => {
  const t = s.replace(/_/g, ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

// Plain labels for the stored keys, in one place: wallet_ledger categories (entry_type when a row has none),
// settlement_ledger entry types, and transaction gateways.
const WALLET_LABEL: Record<string, string> = {
  recharge: 'Top-up',
  debit: 'Charge',
  adjustment: 'Adjustment',
  goodwill_credit: 'Credit from Jeffi',
  shipping_forward: 'Shipping',
  shipping_rvp: 'Return pickup',
  shipping_correction: 'Shipping correction',
  shipping_cancel_credit: 'Cancelled shipment refund',
  campaign: 'Marketing campaign',
  ai: 'AI usage',
  sms: 'SMS message',
  whatsapp: 'WhatsApp message',
  email: 'Email',
  media: 'Media',
  ad_free: 'Ad-free',
  messaging_addon: 'SMS & WhatsApp add-on',
  domain: 'Domain',
  infra: 'Servers',
  showcase: 'Showcase site',
}
const LEDGER_LABEL: Record<string, string> = {
  order_capture: 'Sale (your share)',
  commission: 'Platform commission',
  gateway_fee: 'Payment gateway fee',
  subscription_charge: 'Subscription charge',
  cod_remittance: 'Cash-on-delivery remittance',
  delhivery_correction: 'Shipping charge correction',
  refund: 'Refund',
  payout: 'Payout to your bank',
  adjustment: 'Adjustment',
}
const GATEWAY_LABEL: Record<string, string> = { razorpay: 'Razorpay', phonepe: 'PhonePe', upi: 'UPI', cashfree: 'Cashfree' }

export function walletEntryLabel(e: { entry_type: string; category: string | null }) {
  const k = e.category || e.entry_type
  return WALLET_LABEL[k] ?? humanize(k)
}
export function walletEntryNote(e: { category: string | null; note: string | null }) {
  return e.category === 'ai' ? aiLedgerNote(e.note) : e.note
}
export function ledgerEntryLabel(type: string) {
  return LEDGER_LABEL[type] ?? humanize(type)
}

/** Where an empty sales list points next: add a store, follow its setup, or open the live store. */
export function salesNextStep(t: { slug: string; status: string; service_types?: string[] | null }) {
  if (!(t.service_types ?? ['store']).includes('store')) return { href: '/dashboard/add-store', label: 'Add a store' }
  if (t.status !== 'active') return { href: '/dashboard', label: 'See store setup' }
  return { href: `https://${t.slug}.jeffistores.in`, label: 'Open your store' }
}

const TH = 'px-4 py-3 text-xs font-semibold text-foreground-muted uppercase tracking-widest'
const TR = 'border-t border-border-default/60 hover:bg-surface-secondary/40'
const WRAP = 'rounded-2xl border border-border-default bg-surface-elevated overflow-x-auto'

/**
 * The store's money at a glance. `balance` names its own label: Overview shows the prepaid wallet (tenant_wallets,
 * as the Wallet page does); the settlement ledger shows its settlement balance.
 */
export function MoneyTiles({
  balance,
  totals,
}: {
  balance: { label: string; value: number }
  totals: { gross: number; tenantShare: number; commission: number; fees: number }
}) {
  const tiles = [
    { label: balance.label, value: fmt(balance.value), accent: true },
    { label: 'Gross GMV', value: fmt(totals.gross) },
    { label: 'Your earnings', value: fmt(totals.tenantShare) },
    { label: 'Platform fees', value: fmt(totals.commission + totals.fees) },
  ]
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {tiles.map(t => (
        <StatTile key={t.label} label={t.label} value={t.value} accent={t.accent} />
      ))}
    </div>
  )
}

export function TransactionsTable({
  transactions,
  totals,
  empty,
}: {
  transactions: TenantTransaction[]
  totals: { gross: number; tenantShare: number; commission: number; fees: number }
  /** Shown when there are no rows (an EmptyState with the next step). */
  empty: ReactNode
}) {
  if (transactions.length === 0) return <>{empty}</>
  return (
    <div className={WRAP}>
      <table className="w-full text-sm min-w-[700px]">
        <thead>
          <tr className="bg-surface-secondary text-left">
            {['Order ref', 'Date', 'Gross', 'Your share', 'Commission', 'Gateway fee', 'Method', 'Status', 'Paid out'].map(h => (
              <th key={h} className={TH}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {transactions.map(t => (
            <tr key={t.id} className={TR}>
              <td className="px-4 py-3 font-medium text-foreground">
                {t.order_ref ?? <span className="text-foreground-secondary font-mono text-xs">{t.id.slice(0, 8)}</span>}
              </td>
              <td className="px-4 py-3 text-foreground-secondary whitespace-nowrap">{fmtDate(t.occurred_at)}</td>
              <td className="px-4 py-3 font-medium">{fmt(Number(t.gross_amount))}</td>
              <td className="px-4 py-3 font-semibold org-sage-text">{fmt(Number(t.tenant_share))}</td>
              <td className="px-4 py-3 text-foreground-secondary">{fmt(Number(t.platform_commission))}</td>
              <td className="px-4 py-3 text-foreground-secondary">{fmt(Number(t.gateway_fee))}</td>
              <td className="px-4 py-3 text-foreground-secondary">{t.is_cod ? 'COD' : t.gateway ? (GATEWAY_LABEL[t.gateway] ?? humanize(t.gateway)) : '-'}</td>
              <td className="px-4 py-3">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_PILL[t.status] ?? 'bg-surface-secondary text-foreground-muted'}`}>
                  {humanize(t.status)}
                </span>
              </td>
              <td className="px-4 py-3 text-foreground-secondary whitespace-nowrap">
                {t.payout_at ? (
                  <>
                    {fmtDate(t.payout_at)}
                    {t.payout_utr && <span className="block font-mono text-[10px] text-foreground-muted">UTR {t.payout_utr}</span>}
                  </>
                ) : (
                  '-'
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t-2 border-border-default bg-surface-secondary">
          <tr>
            <td className="px-4 py-3 font-semibold text-foreground-secondary" colSpan={2}>Totals</td>
            <td className="px-4 py-3 font-bold">{fmt(totals.gross)}</td>
            <td className="px-4 py-3 font-bold org-sage-text">{fmt(totals.tenantShare)}</td>
            <td className="px-4 py-3 font-bold text-foreground-secondary">{fmt(totals.commission)}</td>
            <td className="px-4 py-3 font-bold text-foreground-secondary">{fmt(totals.fees)}</td>
            <td colSpan={3} />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

export function LedgerTable({ ledger, balance, empty }: { ledger: LedgerEntry[]; balance: number; empty: ReactNode }) {
  if (ledger.length === 0) return <>{empty}</>
  return (
    <div className={WRAP}>
      <table className="w-full text-sm min-w-[500px]">
        <thead>
          <tr className="bg-surface-secondary text-left">
            {['Date', 'Type', 'Amount', 'Note'].map(h => (
              <th key={h} className={TH}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ledger.map(e => {
            const amt = Number(e.amount)
            return (
              <tr key={e.id} className={TR}>
                <td className="px-4 py-3 text-foreground-secondary whitespace-nowrap">{fmtDate(e.occurred_at)}</td>
                <td className="px-4 py-3">
                  <span className={`font-medium ${LEDGER_COLORS[e.entry_type] ?? 'text-foreground-secondary'}`}>
                    {ledgerEntryLabel(e.entry_type)}
                  </span>
                </td>
                <td className={`px-4 py-3 font-semibold ${amt >= 0 ? 'org-sage-text' : 'text-[#8a2e1f]'}`}>
                  {amt >= 0 ? '+' : '-'}{fmt(amt)}
                </td>
                <td className="px-4 py-3 text-foreground-secondary text-xs">{e.note ?? '—'}</td>
              </tr>
            )
          })}
        </tbody>
        <tfoot className="border-t-2 border-border-default bg-surface-secondary">
          <tr>
            <td className="px-4 py-3 font-semibold text-foreground-secondary" colSpan={2}>Settlement balance</td>
            <td className={`px-4 py-3 font-bold ${balance >= 0 ? 'org-sage-text' : 'text-[#8a2e1f]'}`}>
              {balance >= 0 ? '+' : '-'}{fmt(balance)}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

/** What the payment provider paid into the store's bank, newest first. A table inside a Card (sand heading row). */
export function PayoutsTable({ payouts, empty }: { payouts: LinkedPayout[]; empty: ReactNode }) {
  if (payouts.length === 0) return <>{empty}</>
  return (
    <div className="-mx-6 -mb-6 overflow-x-auto">
      <table className="w-full text-sm min-w-[500px]">
        <thead className="org-sand text-foreground-secondary">
          <tr>
            {['Paid on', 'Amount', 'Fees', 'Bank reference (UTR)', 'Status'].map(h => (
              <th key={h} className="px-6 py-2 text-left text-xs font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border-default">
          {payouts.map(p => (
            <tr key={p.id}>
              <td className="px-6 py-2.5 text-foreground-secondary whitespace-nowrap">{p.settled_at ? fmtDate(p.settled_at) : '-'}</td>
              <td className="px-6 py-2.5 font-semibold tabular-nums org-sage-text">{fmt(Number(p.amount))}</td>
              <td className="px-6 py-2.5 tabular-nums text-foreground-secondary">{fmt(Number(p.fees))}</td>
              <td className="px-6 py-2.5 font-mono text-xs">{p.utr || '-'}</td>
              <td className="px-6 py-2.5 text-foreground-secondary">{p.status ? humanize(p.status) : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
