'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'
import type { TenantRow } from '@/lib/tenant-registry'
import { ChoiceCards, Segmented, focusRing } from '../../_ui'

interface Plan {
  slug: string
  name: string
  tier: number
  monthly_price_inr: string
}
type Interval = 'monthly' | 'yearly'

const SUB_STATUS_LABEL: Record<string, { label: string; color: string }> = {
  active: { label: 'Active', color: 'org-sage org-sage-text' },
  created: { label: 'Pending', color: 'org-peach org-brown' },
  authenticated: {
    label: 'Pending',
    color: 'org-peach org-brown',
  },
  halted: { label: 'Halted', color: 'bg-[#f2d4cd] text-[#8a2e1f]' },
  cancelled: { label: 'Cancelled', color: 'bg-surface-secondary text-foreground-muted' },
  completed: { label: 'Completed', color: 'bg-surface-secondary text-foreground-muted' },
  expired: { label: 'Expired', color: 'bg-surface-secondary text-foreground-muted' },
}

export default function BillingClient({
  tenant,
  plans,
  renewalDate,
}: {
  tenant: TenantRow
  plans: Plan[]
  renewalDate: string | null
}) {
  const router = useRouter()
  const { showToast } = useToast()
  const [selectedPlan, setSelectedPlan] = useState(tenant.plan ?? 'basic')
  const [interval, setInterval] = useState<Interval>((tenant.billing_interval as Interval) ?? 'monthly')
  const [busy, setBusy] = useState(false)
  const [cancelBusy, setCancelBusy] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)

  const currentTier = plans.find(p => p.slug === tenant.plan)?.tier ?? 1
  const newTier = plans.find(p => p.slug === selectedPlan)?.tier ?? 1
  const isUpgrade =
    newTier > currentTier ||
    (newTier === currentTier && interval === 'yearly' && (tenant.billing_interval ?? 'monthly') === 'monthly')
  const isDowngrade =
    newTier < currentTier ||
    (newTier === currentTier && interval === 'monthly' && (tenant.billing_interval ?? 'monthly') === 'yearly')
  const unchanged = selectedPlan === tenant.plan && interval === (tenant.billing_interval ?? 'monthly')

  async function changePlan() {
    if (unchanged) return
    setBusy(true)
    try {
      const res = await fetch('/api/ecom/billing/change-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: tenant.id, planSlug: selectedPlan, billingInterval: interval }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error || 'Failed to change plan', 'error')
        return
      }

      if (data.status === 'upgrade' && data.checkoutUrl) {
        window.location.href = data.checkoutUrl
        return
      }

      const effectiveDate = data.scheduledAt
        ? new Date(data.scheduledAt * 1000).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })
        : 'next renewal'
      showToast(`Plan change scheduled — takes effect on ${effectiveDate}.`, 'success')
      router.refresh()
    } catch {
      showToast('Network error', 'error')
    } finally {
      setBusy(false)
    }
  }

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

  const canCancel =
    !!tenant.razorpay_subscription_id && !['cancelled', 'completed', 'expired'].includes(tenant.subscription_status)

  return (
    <div className="space-y-8">
      {/* Current plan card */}
      <div className="rounded-2xl border border-border-default bg-surface-elevated p-6">
        <h2 className="text-sm font-semibold text-foreground-muted uppercase tracking-widest mb-4">
          Current subscription
        </h2>
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <div className="text-2xl font-bold text-foreground capitalize">{tenant.plan ?? '—'}</div>
            <div className="text-sm text-foreground-muted mt-0.5 capitalize">
              {tenant.billing_interval ?? 'monthly'} billing
            </div>
          </div>
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${subStatusInfo.color}`}
          >
            {subStatusInfo.label}
          </span>
          {renewalDate && (
            <div className="text-sm text-foreground-muted ml-auto">
              Next renewal: <span className="text-foreground font-medium">{renewalDate}</span>
            </div>
          )}
        </div>
        {tenant.razorpay_subscription_id && (
          <div className="text-xs text-foreground-muted mt-3 font-mono">{tenant.razorpay_subscription_id}</div>
        )}
      </div>

      {/* Change plan */}
      <div className="rounded-2xl border border-border-default bg-surface-elevated p-6">
        <h2 className="text-sm font-semibold text-foreground-muted uppercase tracking-widest mb-4">Change plan</h2>

        {/* Interval toggle */}
        <Segmented<Interval> ariaLabel="Billing interval" className="mb-5" value={interval} onChange={setInterval}
          options={[{ value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly', count: '2 months free' }]} />

        {/* Plan cards */}
        <ChoiceCards ariaLabel="Plan" className="mb-6" columns="grid-cols-2 lg:grid-cols-4" cardClassName="p-3" value={selectedPlan} onChange={setSelectedPlan}
          options={plans.map(p => {
            const monthly = Number(p.monthly_price_inr)
            const price = interval === 'yearly' ? monthly * 10 : monthly
            const isCurrent = p.slug === tenant.plan && interval === (tenant.billing_interval ?? 'monthly')
            return {
              value: p.slug, label: p.name,
              content: (
                <>
                  {isCurrent && (
                    <span className="absolute -top-2 left-3 px-1.5 py-0.5 rounded text-[10px] font-semibold ecom-accent-bg text-white">
                      Current
                    </span>
                  )}
                  <div className="pr-6 font-semibold text-foreground">{p.name}</div>
                  <div className="text-sm font-bold text-foreground mt-1">
                    ₹{price.toLocaleString('en-IN')}
                    <span className="text-xs text-foreground-muted font-normal">
                      /{interval === 'yearly' ? 'yr' : 'mo'}
                    </span>
                  </div>
                  {interval === 'yearly' && (
                    <div className="text-xs org-sage-text">2 months free</div>
                  )}
                </>
              ),
            }
          })} />

        {/* Action summary + confirm */}
        {!unchanged && (
          <div className="rounded-xl bg-surface-secondary border border-border-default p-4 mb-4 text-sm text-foreground-secondary">
            {isUpgrade ? (
              <>
                Upgrading to{' '}
                <span className="font-semibold text-foreground capitalize">
                  {selectedPlan} ({interval})
                </span>{' '}
                — charged immediately with a prorated credit for your unused days.
              </>
            ) : isDowngrade ? (
              <>
                Downgrading to{' '}
                <span className="font-semibold text-foreground capitalize">
                  {selectedPlan} ({interval})
                </span>{' '}
                — takes effect at your next renewal date.
              </>
            ) : (
              <>
                Switching to <span className="font-semibold text-foreground capitalize">{interval}</span> billing —
                takes effect at your next renewal.
              </>
            )}
          </div>
        )}

        <button
          onClick={changePlan}
          disabled={busy || unchanged}
          className={`px-5 py-2.5 rounded-xl bg-accent-600 hover:bg-accent-700 disabled:opacity-40 text-white text-sm font-semibold transition-colors ${focusRing}`}
        >
          {busy ? 'Updating…' : isUpgrade ? 'Upgrade now' : 'Schedule change'}
        </button>
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
