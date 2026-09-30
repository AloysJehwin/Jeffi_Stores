'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { TenantRow } from '@/lib/tenant-registry'

interface Plan {
  slug: string
  name: string
  tier: number
  monthly_price_inr: string
}
type Interval = 'monthly' | 'yearly'

const SUB_STATUS_LABEL: Record<string, { label: string; color: string }> = {
  active: { label: 'Active', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  created: { label: 'Pending', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
  authenticated: {
    label: 'Pending',
    color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  },
  halted: { label: 'Halted', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
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
  const [selectedPlan, setSelectedPlan] = useState(tenant.plan ?? 'basic')
  const [interval, setInterval] = useState<Interval>((tenant.billing_interval as Interval) ?? 'monthly')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [cancelBusy, setCancelBusy] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [cancelMsg, setCancelMsg] = useState<{ ok: boolean; text: string } | null>(null)

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
    setMsg(null)
    try {
      const res = await fetch('/api/ecom/billing/change-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: tenant.id, planSlug: selectedPlan, billingInterval: interval }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMsg({ ok: false, text: data.error || 'Failed to change plan' })
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
      setMsg({ ok: true, text: `Plan change scheduled — takes effect on ${effectiveDate}.` })
      router.refresh()
    } catch {
      setMsg({ ok: false, text: 'Network error' })
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
    setCancelMsg(null)
    try {
      const res = await fetch('/api/ecom/provisioning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deprovision', tenantId: tenant.id }),
      })
      const data = await res.json()
      if (!res.ok) {
        setCancelMsg({ ok: false, text: data.error || 'Failed to cancel' })
        return
      }
      setCancelMsg({
        ok: true,
        text: 'Subscription cancelled — your store stays live until the end of the current billing cycle, then closes.',
      })
      setConfirmCancel(false)
      router.refresh()
    } catch {
      setCancelMsg({ ok: false, text: 'Network error' })
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
        <div className="inline-flex items-center rounded-lg border border-border-default bg-surface-secondary p-1 mb-5">
          {(['monthly', 'yearly'] as Interval[]).map(iv => (
            <button
              key={iv}
              type="button"
              onClick={() => setInterval(iv)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${interval === iv ? 'bg-surface-elevated text-foreground shadow-sm' : 'text-foreground-muted'}`}
            >
              {iv}
              {iv === 'yearly' && (
                <span className="ml-1.5 text-xs text-green-600 dark:text-green-400 font-semibold">20% off</span>
              )}
            </button>
          ))}
        </div>

        {/* Plan cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          {plans.map(p => {
            const monthly = Number(p.monthly_price_inr)
            const price = interval === 'yearly' ? monthly * 12 : monthly
            const isCurrent = p.slug === tenant.plan && interval === (tenant.billing_interval ?? 'monthly')
            return (
              <button
                key={p.slug}
                type="button"
                onClick={() => setSelectedPlan(p.slug)}
                className={`rounded-xl border p-3 text-left transition-colors relative ${selectedPlan === p.slug ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20' : 'border-border-default'}`}
              >
                {isCurrent && (
                  <span className="absolute -top-2 left-3 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-accent-600 text-white">
                    Current
                  </span>
                )}
                <div className="font-semibold text-foreground">{p.name}</div>
                <div className="text-sm font-bold text-foreground mt-1">
                  ₹{price.toLocaleString('en-IN')}
                  <span className="text-xs text-foreground-muted font-normal">
                    /{interval === 'yearly' ? 'yr' : 'mo'}
                  </span>
                </div>
                {interval === 'yearly' && (
                  <div className="text-xs text-green-600 dark:text-green-400">20% off at checkout</div>
                )}
              </button>
            )
          })}
        </div>

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

        {msg && (
          <p
            className={`text-sm mb-3 ${msg.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
          >
            {msg.text}
          </p>
        )}

        <button
          onClick={changePlan}
          disabled={busy || unchanged}
          className="px-5 py-2.5 rounded-lg bg-accent-600 hover:bg-accent-700 disabled:opacity-40 text-white text-sm font-semibold transition-colors"
        >
          {busy ? 'Updating…' : isUpgrade ? 'Upgrade now' : 'Schedule change'}
        </button>
      </div>

      {/* Cancel subscription */}
      {canCancel && (
        <div className="rounded-2xl border border-red-200 dark:border-red-900/40 bg-surface-elevated p-6">
          <h2 className="text-sm font-semibold text-red-700 dark:text-red-400 uppercase tracking-widest mb-2">
            Cancel subscription
          </h2>
          <p className="text-sm text-foreground-muted mb-4">
            Cancelling stops future billing. Your store stays live until the end of the current billing cycle, then it
            is closed and its data is backed up.
          </p>
          {cancelMsg && (
            <p
              className={`text-sm mb-3 ${cancelMsg.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
            >
              {cancelMsg.text}
            </p>
          )}
          {!confirmCancel ? (
            <button
              onClick={() => {
                setConfirmCancel(true)
                setCancelMsg(null)
              }}
              className="px-5 py-2.5 rounded-lg border border-red-300 dark:border-red-800 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 text-sm font-semibold transition-colors"
            >
              Cancel subscription
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-foreground">Are you sure? This closes your store at cycle end.</span>
              <button
                onClick={cancelSubscription}
                disabled={cancelBusy}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-sm font-semibold transition-colors"
              >
                {cancelBusy ? 'Cancelling…' : 'Yes, cancel'}
              </button>
              <button
                onClick={() => setConfirmCancel(false)}
                disabled={cancelBusy}
                className="px-4 py-2 rounded-lg border border-border-default text-foreground-muted hover:bg-surface-secondary text-sm font-medium transition-colors"
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
