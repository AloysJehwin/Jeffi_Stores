import type { TenantTransaction, LedgerEntry } from '@/lib/tenant-registry'

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
export function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const TH = 'px-4 py-3 text-xs font-semibold text-foreground-muted uppercase tracking-widest'
const TR = 'border-t border-border-default/60 hover:bg-surface-secondary/40'
const WRAP = 'rounded-2xl border border-border-default bg-surface-elevated overflow-x-auto'

export function MoneyTiles({
  balance,
  totals,
}: {
  balance: number
  totals: { gross: number; tenantShare: number; commission: number; fees: number }
}) {
  const tiles = [
    { label: 'Wallet balance', value: fmt(balance), accent: true },
    { label: 'Gross GMV', value: fmt(totals.gross) },
    { label: 'Your earnings', value: fmt(totals.tenantShare) },
    { label: 'Platform fees', value: fmt(totals.commission + totals.fees) },
  ]
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {tiles.map(t => (
        <div key={t.label} className="rounded-2xl border border-border-default bg-surface-elevated p-4 sm:p-5">
          <div className="text-xs text-foreground-muted uppercase tracking-widest mb-2">{t.label}</div>
          <div className={`font-display text-lg sm:text-2xl lg:text-3xl font-black tabular-nums [overflow-wrap:anywhere] sm:[overflow-wrap:normal] ${t.accent ? 'ecom-accent-text' : 'text-foreground'}`}>
            {t.value}
          </div>
        </div>
      ))}
    </div>
  )
}

export function TransactionsTable({
  transactions,
  totals,
}: {
  transactions: TenantTransaction[]
  totals: { gross: number; tenantShare: number; commission: number; fees: number }
}) {
  if (transactions.length === 0) {
    return <div className={`${WRAP} py-16 text-center text-foreground-secondary text-sm`}>No transactions yet</div>
  }
  return (
    <div className={WRAP}>
      <table className="w-full text-sm min-w-[700px]">
        <thead>
          <tr className="bg-surface-secondary text-left">
            {['Order ref', 'Date', 'Gross', 'Your share', 'Commission', 'Gateway fee', 'Method', 'Status'].map(h => (
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
              <td className="px-4 py-3 text-foreground-secondary">{t.is_cod ? 'COD' : t.gateway}</td>
              <td className="px-4 py-3">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_PILL[t.status] ?? 'bg-surface-secondary text-foreground-muted'}`}>
                  {t.status}
                </span>
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
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

export function LedgerTable({ ledger, balance }: { ledger: LedgerEntry[]; balance: number }) {
  if (ledger.length === 0) {
    return <div className={`${WRAP} py-16 text-center text-foreground-secondary text-sm`}>No ledger entries yet</div>
  }
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
                  <span className={`font-medium capitalize ${LEDGER_COLORS[e.entry_type] ?? 'text-foreground-secondary'}`}>
                    {e.entry_type.replace(/_/g, ' ')}
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
            <td className="px-4 py-3 font-semibold text-foreground-secondary" colSpan={2}>Balance</td>
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
