'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'
import type { TenantRow } from '@/lib/tenant-registry'
import { focusRing } from '../../_ui'

interface Plan {
  slug: string
  name: string
  tier: number
  monthly_price_inr: string
}

const SUB_STATUS_LABEL: Record<string, { label: string; color: string }> = {
  active: { label: 'Active', color: 'org-sage org-sage-text' },
  created: { label: 'Pending', color: 'org-peach org-brown' },
  authenticated: { label: 'Pending', color: 'org-peach org-brown' },
  halted: { label: 'Halted', color: 'bg-[#f2d4cd] text-[#8a2e1f]' },
  cancelled: { label: 'Cancelled', color: 'bg-surface-secondary text-foreground-muted' },
  completed: { label: 'Completed', color: 'bg-surface-secondary text-foreground-muted' },
  expired: { label: 'Expired', color: 'bg-surface-secondary text-foreground-muted' },
}

export default function BillingClient({
  tenant,
  plans,
  renewalDate,
  priceInrMonth = null,
  paymentsEnabled = false,
}: {
  tenant: TenantRow
  plans: Plan[]
  renewalDate: string | null
  /** tenant_compute.price_inr_month: plan fee + servers + GST on servers. */
  priceInrMonth?: number | null
  paymentsEnabled?: boolean
}) {
  const router = useRouter()
  const { showToast } = useToast()
  const [cancelBusy, setCancelBusy] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)

  const subStatusInfo = SUB_STATUS_LABEL[tenant.subscription_status] ?? {
    label: tenant.subscription_status,
    color: 'bg-surface-secondary text-foreground-muted',
  }

  async function cancelSubscription() {
    setCancelBusy(true)
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
      showToast(
        'Subscription cancelled — your store stays live until the end of the current billing cycle, then closes.',
        'success'
      )
      setConfirmCancel(false)
      router.refresh()
    } catch {
      showToast('Network error', 'error')
    } finally {
      setCancelBusy(false)
    }
  }

  // No subscription behind the store (payments off, or not yet paid): no status badge to show.
  const hasSubscription = !!tenant.razorpay_subscription_id
  const plan = plans.find(p => p.slug === tenant.plan)
  const fee = Number(plan?.monthly_price_inr ?? 0)
  const yearly = tenant.billing_interval === 'yearly'
  const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

  const canCancel =
    !!tenant.razorpay_subscription_id && !['cancelled', 'completed', 'expired'].includes(tenant.subscription_status)

  return (
    <div className="space-y-8">
      {/* Current subscription */}
      <div className="rounded-2xl border border-border-default bg-surface-elevated p-6">
        <h2 className="text-sm font-semibold text-foreground-muted uppercase tracking-widest mb-4">
          Current subscription
        </h2>
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <div className="text-2xl font-bold text-foreground">{plan?.name ?? tenant.plan ?? '—'}</div>
            <div className="text-sm text-foreground-muted mt-0.5 capitalize">
              {tenant.billing_interval ?? 'monthly'} billing
            </div>
          </div>
          {hasSubscription ? (
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${subStatusInfo.color}`}
            >
              {subStatusInfo.label}
            </span>
          ) : (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-surface-secondary text-foreground-muted">
              {paymentsEnabled ? 'Awaiting payment' : 'Not billed yet'}
            </span>
          )}
          {renewalDate && (
            <div className="text-sm text-foreground-muted ml-auto">
              Next renewal: <span className="text-foreground font-medium">{renewalDate}</span>
            </div>
          )}
          {tenant.pending_plan && (
            <div className="w-full text-sm text-foreground-muted">
              Moves to <span className="text-foreground font-medium">{plans.find(p => p.slug === tenant.pending_plan)?.name ?? tenant.pending_plan}</span>
              {tenant.pending_billing_interval ? ` (${tenant.pending_billing_interval})` : ''} at the next renewal.
            </div>
          )}
        </div>
        {priceInrMonth != null && priceInrMonth > 0 && (
          <div className="mt-4 text-sm text-foreground-secondary">
            Plan {inr(fee)} + servers {inr(Math.max(0, priceInrMonth - fee))} (incl. GST) ={' '}
            <span className="font-semibold text-foreground">{inr(priceInrMonth)}/mo</span>
            {yearly && <> · billed {inr(priceInrMonth * 10)}/yr</>}
            {!hasSubscription && !paymentsEnabled && <span className="text-foreground-muted"> (billing starts later)</span>}
          </div>
        )}
        {tenant.razorpay_subscription_id && (
          <div className="text-xs text-foreground-muted mt-3 font-mono">{tenant.razorpay_subscription_id}</div>
        )}
        <p className="mt-4 text-sm text-foreground-secondary">
          Change your plan or server size on <a href="/dashboard/compute" className={`underline ${focusRing}`}>Plan &amp; servers</a>.
        </p>
      </div>

      {/* Cancel subscription */}
      {canCancel && (
        <div className="rounded-2xl border border-[#e0a89c] bg-surface-elevated p-6">
          <h2 className="text-sm font-semibold text-[#8a2e1f] uppercase tracking-widest mb-2">
            Cancel subscription
          </h2>
          <p className="text-sm text-foreground-muted mb-4">
            Cancelling stops future billing. Your store stays live until the end of the current billing cycle, then it
            is closed and its data is backed up.
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
              <span className="text-sm text-foreground">Are you sure? This closes your store at cycle end.</span>
              <button
                onClick={cancelSubscription}
                disabled={cancelBusy}
                className="px-4 py-2 rounded-xl bg-[#8a2e1f] hover:bg-[#6f2418] disabled:opacity-40 text-white text-sm font-semibold transition-colors"
              >
                {cancelBusy ? 'Cancelling…' : 'Yes, cancel'}
              </button>
              <button
                onClick={() => setConfirmCancel(false)}
                disabled={cancelBusy}
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
