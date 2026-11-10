import { getTenantBilling, getTenantUpiId } from '@/lib/tenant-registry'
import { getTenantWallet } from '@/lib/payments/wallet'
import { hasOwnDelhiveryToken, storedPhonePeCreds, storedRazorpayKeys } from '@/lib/integrations/resolve'
import { DETAIL_PAGE_SIZE, loadTenantDetail, pageParam } from '@controller/lib/ecom/detail'
import TenantObjectHeader from '@controller/components/admin/ecom/TenantObjectHeader'
import { Field, FieldGrid, Section } from '@controller/components/admin/ecom/EcomUI'
import { inr, inrHr } from '@controller/components/admin/ecom/cells'
import { LedgerTable, TransactionsTable, WalletTable } from '@controller/components/admin/ecom/detail/BillingTables'
import SettingRow from '@controller/components/admin/ecom/detail/SettingRow'
import Copyable from '@controller/components/admin/ecom/detail/Copyable'
import AccountModeToggle from '@controller/components/admin/ecom/detail/AccountModeToggle'
import DeliveryModeToggle from '@controller/components/admin/ecom/detail/DeliveryModeToggle'
import UpiModeToggle from '@controller/components/admin/ecom/detail/UpiModeToggle'
import ReconcileButton from '@controller/components/admin/ecom/detail/ReconcileButton'
import WalletCredit from '@controller/components/admin/ecom/detail/WalletCredit'

export const dynamic = 'force-dynamic'

type Search = { tp?: string; lp?: string; wp?: string }

// The wallet ledger has no count or offset, so a page reads every row up to it (capped like before at 1,000).
const WALLET_PAGES = 100

function Tile({ label, value, tone = 'text-foreground' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border-default bg-surface-elevated px-3 py-2.5 sm:p-4 min-w-0">
      <div className="text-[11px] sm:text-xs text-foreground-muted uppercase tracking-wide font-medium truncate">{label}</div>
      <div className={`text-base sm:text-xl font-bold tabular-nums break-words ${tone}`}>{value}</div>
    </div>
  )
}

const cap = (s: string | null | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : '—')

/** Billing detail page: money in, the accounts it is collected and shipped on, its subscription and wallet. */
export default async function TenantBillingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams])
  const d = await loadTenantDetail(id)
  const { t, cost, row } = d
  const tp = pageParam(sp.tp)
  const lp = pageParam(sp.lp)
  const wp = Math.min(WALLET_PAGES, pageParam(sp.wp))

  const [billing, wallet, ownRazorpayCreds, ownDelhiveryCreds, phonePeCreds, upiId] = await Promise.all([
    getTenantBilling(id, {
      transactions: { limit: DETAIL_PAGE_SIZE, offset: (tp - 1) * DETAIL_PAGE_SIZE },
      ledger: { limit: DETAIL_PAGE_SIZE, offset: (lp - 1) * DETAIL_PAGE_SIZE },
    }),
    getTenantWallet(id, wp * DETAIL_PAGE_SIZE + 1).catch(() => null),
    storedRazorpayKeys(id)
      .then(k => !!k)
      .catch(() => false),
    hasOwnDelhiveryToken(id).catch(() => false),
    storedPhonePeCreds(id)
      .then(c => !!c)
      .catch(() => false),
    getTenantUpiId(id).catch(() => null),
  ])
  const { transactions, ledger, balance, totals } = billing
  const walletRows = wallet?.ledger.slice((wp - 1) * DETAIL_PAGE_SIZE, wp * DETAIL_PAGE_SIZE) ?? []
  const walletNext = wp < WALLET_PAGES && (wallet?.ledger.length ?? 0) > wp * DETAIL_PAGE_SIZE
  const price = row?.price_inr_month ?? cost.priceMonth

  return (
    <div className="p-4 sm:p-6 space-y-5 w-full max-w-full min-w-0 overflow-x-hidden">
      <TenantObjectHeader d={d} back={{ href: '/admin/ecom/billing', label: 'Billing' }} section="billing" />

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2 sm:gap-3">
        <Tile label="Settlement balance" value={inr(balance, 2)} tone={balance >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'} />
        <Tile label="GMV" value={inr(totals.gross, 2)} />
        <Tile label="Tenant share" value={inr(totals.tenantShare, 2)} />
        <Tile label="Your commission" value={inr(totals.commission, 2)} tone="text-accent-600" />
        <Tile label="Gateway fees" value={inr(totals.fees, 2)} />
        <Tile label="COD" value={inr(totals.codGross, 2)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6">
        <Section title="Accounts">
          <div className="divide-y divide-border-default">
            <AccountModeToggle tenantId={id} initial={t.own_razorpay === true} hasOwnCreds={ownRazorpayCreds} />
            {d.isStore && <UpiModeToggle tenantId={id} initial={t.upi_mode ?? 'auto'} hasPhonePe={phonePeCreds} upiId={upiId} />}
            {d.isStore && <DeliveryModeToggle tenantId={id} initial={t.own_delhivery === true} hasOwnCreds={ownDelhiveryCreds} />}
            <SettingRow title="Settlements" value="Reconcile captured" hint="Settles captured rows whose transfer already processed at Razorpay.">
              <ReconcileButton tenantId={id} />
            </SettingRow>
          </div>
        </Section>

        <Section title="Subscription">
          <FieldGrid>
            <Field label="Plan" value={cap(t.plan)} />
            <Field label="Status" value={cap(t.subscription_status)} />
            <Field label="Billing" value={cap(t.billing_interval)} />
            <Field label="Price / month" value={<span className="tabular-nums">{price == null ? '—' : inr(price)}</span>} />
            <Field label="Plan fee" value={<span className="tabular-nums">{t.monthly_price_inr ? inr(t.monthly_price_inr) : '—'}</span>} />
            <Field label="Infra rate" value={<span className="tabular-nums">{inrHr(cost.priceHour)}</span>} />
            <Field label="Infra this month" value={<span className="tabular-nums">{cost.mtdEstimate == null ? '—' : `${inr(cost.mtdEstimate)} est.`}</span>} />
            <Field label="Payout" value={t.daily_payout ? 'Daily (+5%)' : 'Weekly'} />
            <Field wide label="Razorpay subscription" value={<Copyable value={t.razorpay_subscription_id} />} />
            <Field wide label="Linked account" value={<Copyable value={t.razorpay_linked_account_id} />} />
            {t.razorpay_checkout_url && t.subscription_status !== 'active' && (
              <Field
                wide
                label="Checkout link"
                value={
                  <a href={t.razorpay_checkout_url} target="_blank" rel="noopener noreferrer" className="text-accent-600 hover:underline break-all">
                    Open ↗
                  </a>
                }
              />
            )}
          </FieldGrid>
          <p className="mt-3 text-xs text-foreground-muted">Charges collected appear as Subscription charge rows in the settlement ledger below.</p>
        </Section>
      </div>

      <Section title="Shipping wallet" action={<WalletCredit tenantId={id} />}>
        {!wallet ? (
          <p className="text-sm text-foreground-muted">The wallet could not be read.</p>
        ) : (
          <div className="space-y-4 min-w-0">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
              <Tile label="Balance" value={inr(wallet.balance, 2)} tone={wallet.balance >= wallet.minBalance ? 'text-foreground' : 'text-red-600 dark:text-red-400'} />
              <Tile label="Minimum" value={inr(wallet.minBalance, 2)} />
              <Tile label="Ships on" value={t.own_delhivery ? 'Own Delhivery' : 'Platform'} />
            </div>
            <p className="text-xs text-foreground-muted">Prepaid. Shipments on the platform Delhivery account are debited here; so are messaging and AI usage.</p>
            <WalletTable rows={walletRows} hasNext={walletNext} paging={{ page: wp, pageSize: DETAIL_PAGE_SIZE, param: 'wp' }} />
          </div>
        )}
      </Section>

      <Section title="Transactions & splits">
        <TransactionsTable rows={transactions} total={billing.transactionCount} paging={{ page: tp, pageSize: DETAIL_PAGE_SIZE, param: 'tp' }} />
      </Section>

      <Section title="Settlement ledger">
        <LedgerTable rows={ledger} total={billing.ledgerCount} balance={balance} paging={{ page: lp, pageSize: DETAIL_PAGE_SIZE, param: 'lp' }} />
      </Section>
    </div>
  )
}
