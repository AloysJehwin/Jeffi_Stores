import Link from 'next/link'
import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import { migrationQuote } from '@controller/lib/billing/migrate'
import { sameLine, upiNeedsApproval } from '@controller/lib/billing/lines'
import PageHeader from '../../_components/PageHeader'
import { Card } from '../../_components/Card'
import SubscribeClient from './SubscribeClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Set up your subscription' }

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

const TITLE = 'Set up your subscription'
const DESCRIPTION = 'Your monthly charges move from the wallet to one Razorpay subscription: one payment a month, one approval.'

// The switch from wallet-paid add-ons and Showcase sites to the workspace's subscription (migrate.ts).
export default async function SubscribePage({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  const { tenant: tenantSlug } = await searchParams
  const { tenant } = await loadOwnerContext({ tenantSlug })
  const q = await migrationQuote(tenant.id).catch(() => null)
  const billing = `/dashboard/billing?tenant=${encodeURIComponent(tenant.slug)}`
  const back = (
    <Link href={billing} className="text-sm font-semibold ecom-accent-text hover:underline">
      Back to Billing
    </Link>
  )

  if (!q || !q.legacy.length) {
    return (
      <>
        <PageHeader eyebrow="Account" title={TITLE} description={DESCRIPTION} />
        <Card>
          <p className="text-sm text-foreground-secondary mb-4">
            {q ? 'Nothing to move: everything you pay for monthly is already on your subscription.' : 'We could not load your subscription details. Please try again in a moment.'}
          </p>
          {back}
        </Card>
      </>
    )
  }

  const { quote, creditInr, deadline, legacy } = q
  const yearly = quote.interval === 'yearly'
  const per = yearly ? 'yr' : 'mo'
  let due: string
  if (quote.upfrontPaise > 0 && quote.startAt) due = `${rupees(quote.upfrontPaise)} today for the rest of this billing cycle, then ${rupees(quote.cyclePaise)}/${per} from ${fmtDate(quote.startAt)}.`
  else if (quote.startAt) due = `${rupees(quote.cyclePaise)}/${per} from ${fmtDate(quote.startAt)}, your usual billing date.`
  else due = `${rupees(quote.cyclePaise)} when you approve, then every ${yearly ? 'year' : 'month'} on that date.`

  return (
    <>
      <PageHeader eyebrow="Account" title={TITLE} description={DESCRIPTION} />
      <div className="space-y-6">
        {deadline && (
          <div className="rounded-2xl org-peach px-5 py-3 text-sm">
            <strong>Set it up by {fmtDate(deadline)}.</strong> Anything still paid from the wallet after that is paused: Showcase sites go offline and
            add-ons switch off.
          </div>
        )}
        <Card title="On your subscription">
          <ul className="divide-y divide-border-default border-b border-border-default">
            {quote.lines.map(l => (
              <li key={`${l.kind}:${l.ref}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                <span className="min-w-0 flex-1 text-sm font-medium text-foreground break-words">{l.label}</span>
                {legacy.some(x => sameLine(x, l)) && (
                  <span className="inline-flex items-center rounded-full bg-surface-secondary px-2.5 py-0.5 text-xs font-medium text-foreground-muted">Moving from wallet</span>
                )}
                <span className="min-w-[5.5rem] text-right text-sm font-semibold tabular-nums text-foreground">
                  {l.amountPaise === 0 ? 'Included' : `${rupees(l.amountPaise)}/mo`}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-baseline justify-between gap-2 pt-3 text-sm">
            <span className="text-foreground-muted">Monthly total (incl. GST)</span>
            <span className="font-semibold text-foreground tabular-nums">
              {rupees(quote.monthlyPaise)}/mo
              {yearly && <span className="font-normal text-foreground-muted"> · billed {rupees(quote.cyclePaise)}/yr</span>}
            </span>
          </div>
        </Card>
        <Card title="How it works">
          <ul className="space-y-3 text-sm text-foreground-secondary">
            <li>
              <span className="font-medium text-foreground">You pay:</span> {due}
            </li>
            {creditInr > 0 && (
              <li>
                <span className="font-medium text-foreground">Wallet credit:</span> {inr(creditInr)} back to your wallet for wallet-paid time you
                haven&apos;t used yet, once your first subscription payment goes through.
              </li>
            )}
            <li>
              <span className="font-medium text-foreground">Payment:</span>{' '}
              {upiNeedsApproval(quote.cyclePaise)
                ? 'UPI Autopay, a card or eMandate. Above ₹15,000 a charge, UPI asks you to approve each payment.'
                : 'UPI Autopay, a card or eMandate.'}{' '}
              You get a reminder a day before each charge.
            </li>
            <li>
              <span className="font-medium text-foreground">Your wallet</span> keeps paying for usage only: messages, documents, AI and shipping.
            </li>
          </ul>
        </Card>
        <div className="flex flex-wrap items-center gap-4">
          <SubscribeClient tenantSlug={tenant.slug} />
          {back}
        </div>
      </div>
    </>
  )
}
