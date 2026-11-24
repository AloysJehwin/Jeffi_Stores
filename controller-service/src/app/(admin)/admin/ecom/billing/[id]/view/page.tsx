import { controlPlanePool, getTenantBilling, getTenantUpiId } from '@/lib/tenant-registry'
import { getTenantWallet } from '@/lib/payments/wallet'
import { billingOverview } from '@controller/lib/billing/overview'
import { currentSubscription, pendingReplacement, type BillingSubscription } from '@controller/lib/billing/subscription'
import { getTenantBillingCharges } from '@controller/lib/overviews/ecom-billing'
import { hasOwnDelhiveryToken, storedPhonePeCreds, storedRazorpayKeys } from '@/lib/integrations/resolve'
import { DETAIL_PAGE_SIZE, loadTenantDetail, pageParam } from '@controller/lib/ecom/detail'
import TenantObjectHeader from '@controller/components/admin/ecom/TenantObjectHeader'
import { Field, FieldGrid, Section } from '@controller/components/admin/ecom/EcomUI'
import { dateIN, inr, inrHr } from '@controller/components/admin/ecom/cells'
import {
  BillingChargesTable,
  BillingLinesTable,
  LedgerTable,
  SubscriptionBadge,
  TransactionsTable,
  WalletTable,
} from '@controller/components/admin/ecom/detail/BillingTables'
import SettingRow from '@controller/components/admin/ecom/detail/SettingRow'
import Copyable from '@controller/components/admin/ecom/detail/Copyable'
import AccountModeToggle from '@controller/components/admin/ecom/detail/AccountModeToggle'
import DeliveryModeToggle from '@controller/components/admin/ecom/detail/DeliveryModeToggle'
import UpiModeToggle from '@controller/components/admin/ecom/detail/UpiModeToggle'
import ReconcileButton from '@controller/components/admin/ecom/detail/ReconcileButton'
import WalletCredit from '@controller/components/admin/ecom/detail/WalletCredit'

export const dynamic = 'force-dynamic'

type Search = { tp?: string; lp?: string; wp?: string; cp?: string }

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

const METHOD: Record<string, string> = { upi: 'UPI Autopay', card: 'Card', emandate: 'eMandate', nach: 'NACH' }
const PAYING = ['authenticated', 'active', 'pending']
const paise = (v: number) => inr(v / 100, 2)
/** The next charge of a subscription it is paying on: the end of the current cycle, or its first charge. */
const nextCharge = (s: BillingSubscription | null) => (s && PAYING.includes(s.status) ? (s.currentEnd ?? s.startAt) : null)

/** The workspace subscription (lib/billing): current, a replacement waiting for the owner, lines and one page of charges. */
async function loadSubscription(tenantId: string, cp: number) {
  const [overview, current, pending, charges] = await Promise.all([
    billingOverview(tenantId),
    currentSubscription(tenantId),
    pendingReplacement(tenantId),
    getTenantBillingCharges(controlPlanePool(), tenantId, { limit: DETAIL_PAGE_SIZE, offset: (cp - 1) * DETAIL_PAGE_SIZE }),
  ])
  return { overview, current, pending, charges }
}

/** Billing detail page: money in, the accounts it is collected and shipped on, its subscription and wallet. */
export default async function TenantBillingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams])
  const d = await loadTenantDetail(id)
  const { t, cost, row } = d
  const tp = pageParam(sp.tp)
  const lp = pageParam(sp.lp)
  const wp = Math.min(WALLET_PAGES, pageParam(sp.wp))
  const cp = pageParam(sp.cp)

  const [billing, wallet, ownRazorpayCreds, ownDelhiveryCreds, phonePeCreds, upiId, sub] = await Promise.all([
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
    loadSubscription(id, cp).catch(() => null),
  ])
  const { transactions, ledger, balance, totals } = billing
  const walletRows = wallet?.ledger.slice((wp - 1) * DETAIL_PAGE_SIZE, wp * DETAIL_PAGE_SIZE) ?? []
  const walletNext = wp < WALLET_PAGES && (wallet?.ledger.length ?? 0) > wp * DETAIL_PAGE_SIZE
  const price = row?.price_inr_month ?? cost.priceMonth
  const cur = sub?.current ?? null
  const due = nextCharge(cur)

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

        {d.isStore && (
          <Section title="Store plan">
            <FieldGrid>
              <Field label="Plan" value={cap(t.plan)} />
              <Field label="Store status" value={cap(t.subscription_status)} />
              <Field label="Price / month" value={<span className="tabular-nums">{price == null ? '—' : inr(price)}</span>} />
              <Field label="Plan fee" value={<span className="tabular-nums">{t.monthly_price_inr ? inr(t.monthly_price_inr) : '—'}</span>} />
              <Field label="Infra rate" value={<span className="tabular-nums">{inrHr(cost.priceHour)}</span>} />
              <Field label="Infra this month" value={<span className="tabular-nums">{cost.mtdEstimate == null ? '—' : `${inr(cost.mtdEstimate)} est.`}</span>} />
              <Field label="Payout" value={t.daily_payout ? 'Daily (+5%)' : 'Weekly'} />
              <Field wide label="Linked account" value={<Copyable value={t.razorpay_linked_account_id} />} />
            </FieldGrid>
            <p className="mt-3 text-xs text-foreground-muted">The plan is one line of the workspace subscription below.</p>
          </Section>
        )}
      </div>

      <Section title="Subscription">
        {!sub ? (
          <p className="text-sm text-foreground-muted">The subscription could not be read.</p>
        ) : (
          <div className="space-y-5 min-w-0">
            {cur ? (
              <FieldGrid>
                <Field label="Status" value={<SubscriptionBadge status={cur.status} />} />
                <Field label="Billing" value={`${cap(cur.interval)}${cur.mode === 'test' ? ' · test mode' : ''}`} />
                <Field label="Monthly total" value={<span className="tabular-nums">{paise(sub.overview.monthlyPaise)}</span>} />
                <Field label="Next charge" value={due ? <span className="tabular-nums">{`${paise(cur.amountPaise)} on ${dateIN(due)}`}</span> : '—'} />
                <Field label="Payment method" value={cur.paymentMethod ? (METHOD[cur.paymentMethod] ?? cap(cur.paymentMethod)) : '—'} />
                <Field label="Grace until" value={cur.graceUntil ? <span className="text-red-600 dark:text-red-400">{dateIN(cur.graceUntil)}</span> : '—'} />
                <Field wide label="Razorpay subscription" value={<Copyable value={cur.razorpaySubscriptionId} />} />
                {cur.checkoutUrl && !PAYING.includes(cur.status) && (
                  <Field
                    wide
                    label="Checkout link"
                    value={
                      <a href={cur.checkoutUrl} target="_blank" rel="noopener noreferrer" className="text-accent-600 hover:underline break-all">
                        Open ↗
                      </a>
                    }
                  />
                )}
              </FieldGrid>
            ) : (
              <p className="text-sm text-foreground-muted">
                No workspace subscription yet.
                {sub.overview.legacy > 0 && ` ${sub.overview.legacy} line${sub.overview.legacy === 1 ? ' is' : 's are'} still paid from the wallet.`}
              </p>
            )}

            {sub.pending && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 sm:p-4 space-y-3 min-w-0">
                <p className="text-sm font-medium text-foreground">Change waiting for the owner&apos;s approval</p>
                <FieldGrid>
                  <Field label="New amount" value={<span className="tabular-nums">{`${paise(sub.pending.amountPaise)} / ${sub.pending.interval === 'yearly' ? 'year' : 'month'}`}</span>} />
                  <Field label="Upfront" value={<span className="tabular-nums">{sub.pending.upfrontPaise ? paise(sub.pending.upfrontPaise) : '—'}</span>} />
                  <Field label="Starts" value={dateIN(sub.pending.startAt)} />
                  <Field label="Created" value={dateIN(sub.pending.createdAt)} />
                  <Field wide label="Razorpay subscription" value={<Copyable value={sub.pending.razorpaySubscriptionId} />} />
                  {sub.pending.checkoutUrl && (
                    <Field
                      wide
                      label="Approval link"
                      value={
                        <a href={sub.pending.checkoutUrl} target="_blank" rel="noopener noreferrer" className="text-accent-600 hover:underline break-all">
                          Open ↗
                        </a>
                      }
                    />
                  )}
                </FieldGrid>
              </div>
            )}

            <BillingLinesTable rows={sub.overview.lines} />
          </div>
        )}
      </Section>

      <Section title="Subscription charges">
        {!sub ? (
          <p className="text-sm text-foreground-muted">The charges could not be read.</p>
        ) : (
          <div className="space-y-3 min-w-0">
            <BillingChargesTable rows={sub.charges.rows} total={sub.charges.total} paging={{ page: cp, pageSize: DETAIL_PAGE_SIZE, param: 'cp' }} />
            <p className="text-xs text-foreground-muted">
              Each charge is also a Subscription charge row in the settlement ledger below; charges from before the switch to one subscription per workspace are only there.
            </p>
          </div>
        )}
      </Section>

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
