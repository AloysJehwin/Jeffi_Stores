'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'
import type { TenantRow } from '@/lib/tenant-registry'
import { paymentRequired } from '@/lib/billing/payment-required'
import type { BillingOverview, OverviewLine } from '@controller/lib/billing/overview'
import { focusRing } from '../../_ui'

interface Plan {
  slug: string
  name: string
  tier: number
  monthly_price_inr: string
}

const GREY = 'bg-surface-secondary text-foreground-muted'
const PEACH = 'org-peach org-brown'
const SAGE = 'org-sage org-sage-text'
const RED = 'bg-[#f2d4cd] text-[#8a2e1f]'

const SUB_STATUS: Record<string, { label: string; color: string }> = {
  created: { label: 'Awaiting approval', color: PEACH },
  authenticated: { label: 'Approved', color: SAGE },
  active: { label: 'Active', color: SAGE },
  pending: { label: 'Payment due', color: PEACH },
  halted: { label: 'Halted', color: RED },
  cancelled: { label: 'Cancelled', color: GREY },
  completed: { label: 'Completed', color: GREY },
  expired: { label: 'Expired', color: GREY },
}

const LINE_STATUS: Record<OverviewLine['status'], { label: string; color: string }> = {
  trial: { label: 'Free trial', color: PEACH },
  awaiting_payment: { label: 'Awaiting approval', color: PEACH },
  active: { label: 'Active', color: SAGE },
  ending: { label: 'Ending', color: GREY },
  legacy_wallet: { label: 'Paid from wallet', color: GREY },
  ended: { label: 'Ended', color: GREY },
}

const METHOD: Record<string, string> = { upi: 'UPI Autopay', card: 'Card', emandate: 'eMandate (bank account)', nach: 'eMandate (bank account)' }
const ENDED = ['cancelled', 'completed', 'expired']

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
const per = (interval: string) => (interval === 'yearly' ? 'yr' : 'mo')

function lineNote(l: OverviewLine): string | null {
  if (l.status === 'trial' && l.trialEndsAt) return `Free until ${fmtDate(l.trialEndsAt)}`
  if (l.status === 'awaiting_payment') return 'Starts once the payment is approved'
  if (l.status === 'ending' && l.endsAt) return `Ends on ${fmtDate(l.endsAt)}`
  if (l.status === 'legacy_wallet') return l.graceUntil ? `Move it to your subscription by ${fmtDate(l.graceUntil)}` : 'Move it to your subscription'
  if (l.nextAmountPaise != null && l.changesAt && Date.parse(l.changesAt) > Date.now()) return `${rupees(l.nextAmountPaise)}/mo from ${fmtDate(l.changesAt)}`
  if (l.kind === 'showcase_site' && l.amountPaise === 0) return 'Included in your store plan'
  return null
}

const pill = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium'
const btn = 'inline-block px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
const notice = 'mt-4 flex flex-wrap items-center gap-3 rounded-xl px-4 py-3 text-sm'

export default function BillingClient({
  tenant,
  plans,
  overview: initialOverview,
  isStore,
  priceInrMonth = null,
  children,
}: {
  tenant: TenantRow
  plans: Plan[]
  /** null when the subscription couldn't be read. */
  overview: BillingOverview | null
  isStore: boolean
  /** tenant_compute.price_inr_month: plan fee + servers + GST on servers. */
  priceInrMonth?: number | null
  /** Add-on cards, shown between the subscription and the cancel section. */
  children?: ReactNode
}) {
  const router = useRouter()
  const { showToast } = useToast()
  const [overview, setOverview] = useState(initialOverview)
  const [busy, setBusy] = useState<null | 'pay' | 'cancel'>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const api = `/api/ecom/billing/subscription?tenant=${encodeURIComponent(tenant.slug)}`

  async function postSubscription(action: 'pay_now' | 'cancel') {
    const res = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
    return { ok: res.ok, data: await res.json().catch(() => ({})) }
  }

  async function payNow() {
    setBusy('pay')
    try {
      const { ok, data } = await postSubscription('pay_now')
      if (!ok) {
        showToast(data.error || 'Could not start the payment', 'error')
        return
      }
      if (data.checkoutUrl) {
        showToast('Opening Razorpay to complete the payment…', 'info')
        window.location.href = data.checkoutUrl
        return
      }
      setOverview(data)
    } catch {
      showToast('Network error', 'error')
    } finally {
      setBusy(null)
    }
  }

  // A Showcase-only workspace: everything ends at cycle end.
  async function cancelAll() {
    setBusy('cancel')
    try {
      const { ok, data } = await postSubscription('cancel')
      if (!ok) {
        showToast(data.error || 'Could not cancel', 'error')
        return
      }
      setOverview(data)
      setConfirmCancel(false)
      showToast('Subscription cancelled. Your sites stay online until the end of this billing cycle.', 'success')
      router.refresh()
    } catch {
      showToast('Network error', 'error')
    } finally {
      setBusy(null)
    }
  }

  // A store closes through provisioning: its lines end at cycle end, then the store is closed.
  async function closeStore() {
    setBusy('cancel')
    try {
      const res = await fetch('/api/ecom/provisioning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deprovision', tenantId: tenant.id }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error || 'Failed to cancel', 'error')
        return
      }
      setConfirmCancel(false)
      // Showcase sites stay on the subscription: the owner approves its lower amount.
      if (data.checkoutUrl) {
        showToast('Store cancelled. Approve the lower amount for your Showcase sites on Razorpay…', 'info')
        window.location.href = data.checkoutUrl
        return
      }
      showToast('Subscription cancelled — your store stays live until the end of the current billing cycle, then closes.', 'success')
      router.refresh()
    } catch {
      showToast('Network error', 'error')
    } finally {
      setBusy(null)
    }
  }

  const current = overview?.current ?? null
  const pending = overview?.pending ?? null
  const lines = overview?.lines ?? []
  const storeLine = lines.find(l => l.kind === 'store_plan')
  const yearly = current ? current.interval === 'yearly' : tenant.billing_interval === 'yearly'
  // A workspace with no store and no store application has no store subscription to wait for.
  const mandatory = paymentRequired(tenant) && (isStore || !!tenant.store_request)
  const plan = plans.find(p => p.slug === tenant.plan)
  const fee = Number(plan?.monthly_price_inr ?? 0)

  const fallbackStatus = tenant.razorpay_subscription_id ? SUB_STATUS[tenant.subscription_status] ?? { label: tenant.subscription_status, color: GREY } : null
  const status = current ? SUB_STATUS[current.status] ?? { label: current.status, color: GREY } : fallbackStatus
  const idleLabel = lines.some(l => l.status === 'trial') ? 'Free trial' : mandatory ? 'Awaiting payment' : 'Not billed yet'
  const nextCharge = current && ['created', 'authenticated', 'active', 'pending'].includes(current.status) ? current.currentEnd ?? current.startAt : null

  const canCloseStore = isStore && !!tenant.razorpay_subscription_id && !ENDED.includes(tenant.subscription_status) && storeLine?.status !== 'ending'
  const canCancelAll = !isStore && !!current && !ENDED.includes(current.status) && lines.some(l => ['active', 'trial', 'awaiting_payment'].includes(l.status))

  return (
    <div className="space-y-8">
      <div className="rounded-2xl border border-border-default bg-surface-elevated p-6">
        <h2 className="text-sm font-semibold text-foreground-muted uppercase tracking-widest mb-4">Current subscription</h2>
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <div className="text-2xl font-bold text-foreground">{isStore ? plan?.name ?? tenant.plan ?? '—' : 'Showcase'}</div>
            <div className="text-sm text-foreground-muted mt-0.5">{yearly ? 'Yearly' : 'Monthly'} billing</div>
          </div>
          <span className={`${pill} ${status?.color ?? GREY}`}>{status?.label ?? idleLabel}</span>
          {tenant.pending_plan && (
            <div className="w-full text-sm text-foreground-muted">
              Moves to <span className="text-foreground font-medium">{plans.find(p => p.slug === tenant.pending_plan)?.name ?? tenant.pending_plan}</span>
              {tenant.pending_billing_interval ? ` (${tenant.pending_billing_interval})` : ''} at the next renewal.
            </div>
          )}
        </div>

        {(nextCharge || current?.paymentMethod) && (
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            {nextCharge && current && (
              <div>
                <dt className="text-foreground-muted">Next charge</dt>
                <dd className="font-medium text-foreground tabular-nums">
                  {rupees(current.amountPaise)} on {fmtDate(nextCharge)}
                </dd>
              </div>
            )}
            {current?.paymentMethod && (
              <div>
                <dt className="text-foreground-muted">Payment method</dt>
                <dd className="font-medium text-foreground">{METHOD[current.paymentMethod] ?? current.paymentMethod}</dd>
              </div>
            )}
          </dl>
        )}

        {current?.status === 'created' && current.checkoutUrl && (
          <div className={`${notice} org-peach`}>
            <p className="min-w-0 flex-1">Approve the payment on Razorpay to start your subscription.</p>
            <a href={current.checkoutUrl} className={`${btn} bg-accent-600 hover:bg-accent-700 text-white ${focusRing}`}>
              Approve payment
            </a>
          </div>
        )}
        {current?.status === 'pending' && (
          <div className={`${notice} org-peach`}>
            <p className="min-w-0 flex-1">
              <strong>Your last payment didn&apos;t go through.</strong> Razorpay will try again, and everything keeps running meanwhile.
            </p>
            {current.checkoutUrl && (
              <a href={current.checkoutUrl} className={`${btn} border border-border-default text-foreground hover:bg-surface-secondary ${focusRing}`}>
                Update payment method
              </a>
            )}
          </div>
        )}
        {current?.status === 'halted' && (
          <div className={`${notice} bg-[#f6d5cc]/60 text-[#8a2e1f]`}>
            <p className="min-w-0 flex-1">
              <strong>Your payments have stopped.</strong> Razorpay couldn&apos;t collect your last payment. Pay now to keep everything running
              {current.graceUntil ? ` — Showcase sites and add-ons switch off on ${fmtDate(current.graceUntil)} if it stays unpaid` : ''}.
            </p>
            <button onClick={payNow} disabled={busy !== null} className={`${btn} bg-[#8a2e1f] hover:bg-[#6f2418] text-white`}>
              {busy === 'pay' ? 'Opening…' : 'Pay now'}
            </button>
          </div>
        )}
        {pending?.checkoutUrl && (
          <div className={`${notice} org-peach`}>
            <p className="min-w-0 flex-1">
              <strong>A change is waiting for your approval.</strong> New total {rupees(pending.amountPaise)}/{per(pending.interval)}
              {pending.startAt ? ` from ${fmtDate(pending.startAt)}` : ''}
              {pending.upfrontPaise > 0 ? `, plus ${rupees(pending.upfrontPaise)} now for the rest of this cycle` : ''}.
            </p>
            <a href={pending.checkoutUrl} className={`${btn} bg-accent-600 hover:bg-accent-700 text-white ${focusRing}`}>
              Approve
            </a>
          </div>
        )}
        {overview && overview.legacy > 0 && (
          <div className={`${notice} org-peach`}>
            <p className="min-w-0 flex-1">
              {overview.legacy === 1 ? 'One item is' : `${overview.legacy} items are`} still paid from your wallet. Monthly charges are moving to one subscription.
            </p>
            <Link href={`/dashboard/billing/subscribe?tenant=${encodeURIComponent(tenant.slug)}`} className={`${btn} bg-accent-600 hover:bg-accent-700 text-white ${focusRing}`}>
              Set up subscription
            </Link>
          </div>
        )}

        {lines.length > 0 && overview && (
          <div className="mt-6">
            <ul className="divide-y divide-border-default border-y border-border-default">
              {lines.map(l => {
                const st = LINE_STATUS[l.status]
                const note = lineNote(l)
                return (
                  <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground break-words">{l.label}</div>
                      {note && <div className="text-xs text-foreground-muted mt-0.5">{note}</div>}
                    </div>
                    <span className={`${pill} ${st.color}`}>{st.label}</span>
                    <div className="min-w-[5.5rem] text-right text-sm font-semibold tabular-nums text-foreground">{rupees(l.amountPaise)}/mo</div>
                  </li>
                )
              })}
            </ul>
            <div className="flex flex-wrap items-baseline justify-between gap-2 pt-3 text-sm">
              <span className="text-foreground-muted">Monthly total (incl. GST)</span>
              <span className="font-semibold text-foreground tabular-nums">
                {rupees(overview.monthlyPaise)}/mo
                {yearly && <span className="font-normal text-foreground-muted"> · billed {rupees(overview.cyclePaise)}/yr</span>}
              </span>
            </div>
          </div>
        )}

        {isStore && !storeLine && priceInrMonth != null && priceInrMonth > 0 && (
          <div className="mt-4 text-sm text-foreground-secondary">
            Plan {inr(fee)} + servers {inr(Math.max(0, priceInrMonth - fee))} (incl. GST) ={' '}
            <span className="font-semibold text-foreground">{inr(priceInrMonth)}/mo</span>
            {yearly && <> · billed {inr(priceInrMonth * 10)}/yr</>}
            {!current && !mandatory && <span className="text-foreground-muted"> (billing starts later)</span>}
          </div>
        )}
        {isStore && (
          <p className="mt-4 text-sm text-foreground-secondary">
            Change your plan or server size on <a href="/dashboard/compute" className={`underline ${focusRing}`}>Plan &amp; servers</a>.
          </p>
        )}
      </div>

      {children}

      {(canCloseStore || canCancelAll) && (
        <div className="rounded-2xl border border-[#e0a89c] bg-surface-elevated p-6">
          <h2 className="text-sm font-semibold text-[#8a2e1f] uppercase tracking-widest mb-2">Cancel subscription</h2>
          <p className="text-sm text-foreground-muted mb-4">
            {canCloseStore
              ? 'Cancelling stops future billing for your store and its add-ons. Your store stays live until the end of the current billing cycle, then it is closed and its data is backed up.'
              : 'Cancelling stops future billing. Your Showcase sites stay online until the end of the current billing cycle, then go offline.'}
          </p>
          {!confirmCancel ? (
            <button
              onClick={() => setConfirmCancel(true)}
              className="px-5 py-2.5 rounded-xl border border-[#e0a89c] text-[#8a2e1f] hover:bg-[#f2d4cd] text-sm font-semibold transition-colors"
            >
              Cancel subscription
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-foreground">
                {canCloseStore ? 'Are you sure? This closes your store at cycle end.' : 'Are you sure? Your sites go offline at cycle end.'}
              </span>
              <button
                onClick={canCloseStore ? closeStore : cancelAll}
                disabled={busy !== null}
                className="px-4 py-2 rounded-xl bg-[#8a2e1f] hover:bg-[#6f2418] disabled:opacity-40 text-white text-sm font-semibold transition-colors"
              >
                {busy === 'cancel' ? 'Cancelling…' : 'Yes, cancel'}
              </button>
              <button
                onClick={() => setConfirmCancel(false)}
                disabled={busy !== null}
                className="px-4 py-2 rounded-xl border border-border-default text-foreground-muted hover:bg-surface-secondary text-sm font-medium transition-colors"
              >
                Keep subscription
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
