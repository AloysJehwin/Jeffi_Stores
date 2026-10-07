'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useStoreConfig } from '@/contexts/StoreConfigContext'
import { subscribeAllowed } from '@/lib/catalog/digital'
import { bp } from '@/lib/shared/business-path'
import { subscriptionSavingsPct } from '@/lib/subscriptions/sellable'
import {
  SUBSCRIPTION_INTERVAL_LABELS,
  billingCyclesLabel,
  isSubscriptionInterval,
  type SubscriptionInterval,
} from '@/lib/subscriptions/intervals'

export type PurchaseMode = 'once' | 'subscribe'

interface Quote {
  unitPrice: number
  oneTimePrice?: number
  totalCycles?: number | null
  minCycles?: number | null
  quantity: number
  shipping: number
  amount: number
  intervalLabel: string
}

interface SubscribeOptionProps {
  productId: string
  variantId: string | null
  subVariantId: string | null
  isSubscription: boolean
  intervals: string[] | null | undefined
  digital: boolean
  isBusiness?: boolean
  mode: PurchaseMode
  onModeChange: (mode: PurchaseMode) => void
  /** Message to show instead of subscribing when a variant choice is still missing. */
  needsChoice?: string | null
  disabled?: boolean
}

export function subscribeIntervalsFor(
  masterOn: boolean,
  isSubscription: boolean,
  intervals: string[] | null | undefined
): SubscriptionInterval[] {
  if (!subscribeAllowed(masterOn, isSubscription)) return []
  return (intervals ?? []).filter(isSubscriptionInterval)
}

export const formatInr = (n: number) =>
  `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function SubscribeOption({
  productId,
  variantId,
  subVariantId,
  isSubscription,
  intervals,
  digital,
  isBusiness = false,
  mode,
  onModeChange,
  needsChoice,
  disabled,
}: SubscribeOptionProps) {
  const masterOn = useStoreConfig().flags.subscriptionsEnabled
  const { user } = useAuth()
  const router = useRouter()
  const allowed = subscribeIntervalsFor(masterOn, isSubscription, intervals)
  const [interval, setCycle] = useState<SubscriptionInterval | null>(allowed[0] ?? null)
  const [qty, setQty] = useState(1)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [quoting, setQuoting] = useState(false)
  const quantity = digital ? 1 : qty

  useEffect(() => {
    if (mode !== 'subscribe' || !interval || !user || needsChoice) return
    let cancelled = false
    setQuoting(true)
    setQuoteError(null)
    fetch('/api/subscriptions/quote', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(isBusiness ? { 'X-Auth-Portal': 'business' } : {}) },
      body: JSON.stringify({ productId, variantId, subVariantId, interval, quantity }),
    })
      .then(async r => ({ ok: r.ok, data: await r.json().catch(() => ({})) }))
      .then(({ ok, data }) => {
        if (cancelled) return
        if (ok) setQuote(data)
        else {
          setQuote(null)
          setQuoteError(data?.error || 'Could not price this subscription')
        }
      })
      .catch(() => {
        if (!cancelled) setQuoteError('Could not price this subscription')
      })
      .finally(() => {
        if (!cancelled) setQuoting(false)
      })
    return () => {
      cancelled = true
    }
  }, [mode, interval, quantity, productId, variantId, subVariantId, user, needsChoice, isBusiness])

  if (allowed.length === 0) return null

  const subscribe = () => {
    if (!interval || needsChoice) return
    const qs = new URLSearchParams({ product: productId, interval, qty: String(quantity) })
    if (variantId) qs.set('variant', variantId)
    if (subVariantId) qs.set('subVariant', subVariantId)
    router.push(isBusiness ? bp(`/business/subscribe?${qs}`) : `/subscribe?${qs}`)
  }

  const tab = (m: PurchaseMode, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === m}
      onClick={() => onModeChange(m)}
      className={`flex-1 px-3 py-2 rounded-md text-sm font-semibold transition-colors ${
        mode === m ? 'bg-primary-600 text-white' : 'text-foreground-secondary hover:bg-surface-hover'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="rounded-lg border border-border-default bg-surface p-3 space-y-3" data-testid="subscribe-option">
      <div role="tablist" className="flex gap-1 bg-surface-elevated rounded-lg p-1">
        {tab('once', 'One-time purchase')}
        {tab('subscribe', 'Subscribe')}
      </div>

      {mode === 'subscribe' && (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium text-foreground-secondary mb-2">Deliver / renew</p>
            <div className="flex flex-wrap gap-2">
              {allowed.map(iv => (
                <button
                  key={iv}
                  type="button"
                  aria-pressed={interval === iv}
                  onClick={() => setCycle(iv)}
                  className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                    interval === iv
                      ? 'bg-primary-600 text-white border-primary-600'
                      : 'bg-surface-elevated text-foreground-secondary border-border-secondary hover:border-primary-400'
                  }`}
                >
                  {SUBSCRIPTION_INTERVAL_LABELS[iv]}
                </button>
              ))}
            </div>
          </div>

          {!digital && (
            <label className="flex items-center gap-2 text-sm text-foreground-secondary">
              Quantity per cycle
              <select
                aria-label="Quantity per cycle"
                value={qty}
                onChange={e => setQty(Number(e.target.value))}
                className="border border-border-secondary rounded-md px-2 py-1 bg-surface-elevated text-foreground"
              >
                {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="text-sm" data-testid="subscribe-quote">
            {needsChoice ? (
              <span className="text-foreground-muted">{needsChoice}</span>
            ) : !user ? (
              <span className="text-foreground-muted">Sign in to see your subscription price.</span>
            ) : quoting && !quote ? (
              <span className="text-foreground-muted">Calculating price…</span>
            ) : quoteError ? (
              <span className="text-red-600 dark:text-red-400">{quoteError}</span>
            ) : quote ? (
              <span className="text-foreground">
                <span className="text-lg font-bold text-primary-600 dark:text-primary-400">
                  {formatInr(quote.amount)}
                </span>{' '}
                / {quote.intervalLabel.toLowerCase()}
                {quote.shipping > 0 && (
                  <span className="text-foreground-muted"> (incl. {formatInr(quote.shipping)} shipping)</span>
                )}
                <SavingsNote oneTimePrice={quote.oneTimePrice} unitPrice={quote.unitPrice} />
                <TermNote totalCycles={quote.totalCycles} minCycles={quote.minCycles} digital={digital} />
              </span>
            ) : null}
          </div>

          <button
            type="button"
            onClick={subscribe}
            disabled={disabled || !interval || !!needsChoice || !!quoteError}
            className="w-full bg-accent-500 hover:bg-accent-600 text-white px-6 py-4 rounded-lg font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
          >
            Subscribe
          </button>
          <p className="text-xs text-foreground-muted">Auto-renews each cycle. Cancel anytime from My subscriptions.</p>
        </div>
      )}
    </div>
  )
}

export function SavingsNote({ oneTimePrice, unitPrice }: { oneTimePrice?: number; unitPrice: number }) {
  const pct = subscriptionSavingsPct(Number(oneTimePrice ?? 0), unitPrice)
  if (!pct) return null
  return (
    <span className="block text-xs font-semibold text-green-700 dark:text-green-400" data-testid="subscribe-savings">
      Save {pct}% vs one-time ({formatInr(Number(oneTimePrice))} each)
    </span>
  )
}

export function TermNote({
  totalCycles,
  minCycles,
  digital,
}: {
  totalCycles?: number | null
  minCycles?: number | null
  digital: boolean
}) {
  return (
    <span className="block text-xs text-foreground-muted" data-testid="subscribe-term">
      {billingCyclesLabel(totalCycles, digital)}
      {minCycles ? ` · Minimum ${minCycles} charges` : ''}
    </span>
  )
}
