'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import AddressFormModal from '@/components/visitor/AddressFormModal'
import { bp } from '@/lib/shared/business-path'
import { MAX_CYCLE_AMOUNT_INR } from '@/lib/subscriptions/intervals'
import { SavingsNote, TermNote, formatInr } from './SubscribeOption'

const CHECKOUT_JS = 'https://checkout.razorpay.com/v1/checkout.js'

interface Address {
  id: string
  full_name: string
  address_line1: string
  address_line2?: string
  city: string
  state: string
  postal_code: string
  phone: string
  is_default: boolean
}

interface Quote {
  productName?: string
  unitPrice: number
  intervalPrices?: Partial<Record<string, number>>
  interval?: string
  oneTimePrice?: number
  totalCycles?: number | null
  minCycles?: number | null
  quantity: number
  shipping: number
  amount: number
  intervalLabel: string
  isDigital: boolean
  collectingAccount: 'platform' | 'own'
  merchantLabel: string
}

export function SubscribeCheckout({ isBusiness }: { isBusiness: boolean }) {
  const { user, isLoading: authLoading } = useAuth()
  const { showToast } = useToast()
  const router = useRouter()
  const params = useSearchParams()

  const productId = params.get('product') || ''
  const interval = params.get('interval') || ''
  const quantity = Math.min(10, Math.max(1, Math.floor(Number(params.get('qty')) || 1)))
  const variantId = params.get('variant')
  const subVariantId = params.get('subVariant')

  const portalHeader: Record<string, string> = isBusiness ? { 'X-Auth-Portal': 'business' } : {}
  const p = (path: string) => (isBusiness ? bp(`/business${path}`) : path)
  const ordersPath = p('/account/orders')
  const subscriptionsPath = p('/account/subscriptions')

  const [addresses, setAddresses] = useState<Address[]>([])
  const [loadingAddresses, setLoadingAddresses] = useState(true)
  const [selected, setSelected] = useState<Address | null>(null)
  const [showAddressModal, setShowAddressModal] = useState(false)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [consent, setConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [razorpayLoaded, setRazorpayLoaded] = useState(false)
  const authWasLoading = useRef(false)
  const addressesFetched = useRef(false)

  useEffect(() => {
    if (authLoading) authWasLoading.current = true
    const unauth = isBusiness ? !authLoading && !user && authWasLoading.current : !authLoading && !user
    if (unauth) {
      const here = `${window.location.pathname}${window.location.search}`
      router.push(
        isBusiness
          ? bp(`/business/signin?redirect=${encodeURIComponent(here)}`)
          : `/login?redirect=${encodeURIComponent(here)}`
      )
    }
  }, [user, authLoading, isBusiness, router])

  const fetchAddresses = async (preferId?: string) => {
    try {
      const r = await fetch('/api/user/addresses', { credentials: 'include', headers: { ...portalHeader } })
      if (!r.ok) return
      const data = await r.json()
      const list: Address[] = data.addresses || []
      setAddresses(list)
      setSelected(list.find(a => a.id === preferId) || list.find(a => a.is_default) || list[0] || null)
    } catch {
    } finally {
      setLoadingAddresses(false)
    }
  }

  useEffect(() => {
    if (user && !addressesFetched.current) {
      addressesFetched.current = true
      fetchAddresses()
    }
  }, [user])

  useEffect(() => {
    if (!user || !productId || !interval) return
    let cancelled = false
    setQuoteError(null)
    fetch('/api/subscriptions/quote', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...portalHeader },
      body: JSON.stringify({ productId, variantId, subVariantId, interval, quantity, addressId: selected?.id }),
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
      .catch(() => !cancelled && setQuoteError('Could not price this subscription'))
    return () => {
      cancelled = true
    }
  }, [user, productId, interval, quantity, variantId, subVariantId, selected?.id])

  useEffect(() => {
    if (razorpayLoaded) return
    if (document.querySelector(`script[src="${CHECKOUT_JS}"]`)) {
      setRazorpayLoaded(true)
      return
    }
    const script = document.createElement('script')
    script.src = CHECKOUT_JS
    script.async = true
    script.onload = () => setRazorpayLoaded(true)
    script.onerror = () => setError('Failed to load payment gateway. Please try again or contact support.')
    document.body.appendChild(script)
  }, [razorpayLoaded])

  const verify = async (response: {
    razorpay_payment_id: string
    razorpay_subscription_id: string
    razorpay_signature: string
  }) => {
    try {
      const r = await fetch('/api/subscriptions/verify', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...portalHeader },
        body: JSON.stringify(response),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.error || 'Verification failed')
      showToast('Subscription started!', 'success')
      window.location.href = data.orderId ? `${ordersPath}/${data.orderId}` : subscriptionsPath
    } catch {
      setError(
        `Payment received but confirmation is still pending. Check My subscriptions shortly — if nothing appears, contact support with payment ID: ${response.razorpay_payment_id}`
      )
      setSubmitting(false)
    }
  }

  const pay = async () => {
    if (!consent) {
      setError('Please agree to the auto-debit terms to continue.')
      return
    }
    if (!selected) {
      setError('Please select an address.')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const r = await fetch('/api/subscriptions', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...portalHeader },
        body: JSON.stringify({
          productId,
          variantId,
          subVariantId,
          interval,
          quantity,
          addressId: selected.id,
          consent: true,
        }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.error || 'Could not start the subscription')
      const rzp = new (window as any).Razorpay({
        key: data.keyId,
        subscription_id: data.razorpaySubscriptionId,
        name: data.name,
        description: data.description,
        prefill: data.prefill,
        theme: { color: '#f97316' },
        handler: verify,
        modal: {
          ondismiss: () => {
            setSubmitting(false)
            showToast('Payment cancelled — your subscription was not started.', 'info')
          },
        },
      })
      rzp.on('payment.failed', (resp: any) => {
        setError(resp?.error?.description || 'Payment failed. Please try again.')
        setSubmitting(false)
      })
      rzp.open()
    } catch (e: any) {
      setError(e?.message || 'Could not start the subscription')
      setSubmitting(false)
    }
  }

  if (authLoading || !user) return null

  if (!productId || !interval) {
    return (
      <div className="container mx-auto px-4 py-12 text-center">
        <p className="text-foreground-secondary mb-4">Nothing to subscribe to.</p>
        <Link href={isBusiness ? bp('/business') : '/'} className="text-accent-600 font-medium">
          Continue shopping
        </Link>
      </div>
    )
  }

  const merchant = quote?.merchantLabel || 'the store'
  const canPay = !!quote && !!selected && consent && razorpayLoaded && !submitting

  return (
    <div className="container mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold text-foreground mb-4">Start your subscription</h1>
      <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
        <section className="lg:col-span-2 bg-surface-elevated rounded-lg border border-border-default p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-foreground">
              {quote?.isDigital ? 'Billing address' : 'Delivery address'}
            </h2>
            <button
              type="button"
              onClick={() => setShowAddressModal(true)}
              className="text-sm text-accent-600 font-medium"
            >
              + Add new
            </button>
          </div>
          {loadingAddresses ? (
            <div className="h-20 bg-surface rounded-lg animate-pulse" />
          ) : addresses.length === 0 ? (
            <p className="text-sm text-foreground-secondary">No saved addresses. Add one to continue.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {addresses.map(a => (
                <label
                  key={a.id}
                  className={`flex gap-3 p-3 rounded-lg border cursor-pointer ${
                    selected?.id === a.id ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20' : 'border-border-default'
                  }`}
                >
                  <input
                    type="radio"
                    name="address"
                    checked={selected?.id === a.id}
                    onChange={() => setSelected(a)}
                  />
                  <span className="text-sm">
                    <span className="font-semibold text-foreground block">{a.full_name}</span>
                    <span className="text-foreground-secondary">
                      {a.address_line1}
                      {a.address_line2 ? `, ${a.address_line2}` : ''}, {a.city}, {a.state} {a.postal_code}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </section>

        <section className="lg:sticky lg:top-4 bg-surface-elevated rounded-lg border border-border-default p-4 space-y-3">
          <h2 className="font-semibold text-foreground">Each cycle</h2>
          {quote?.productName && <p className="text-sm text-foreground-secondary">{quote.productName}</p>}
          {quoteError ? (
            <p className="text-sm text-red-600 dark:text-red-400">{quoteError}</p>
          ) : !quote ? (
            <div className="h-24 bg-surface rounded-lg animate-pulse" />
          ) : (
            <dl className="text-sm space-y-1" data-testid="subscribe-summary">
              <div className="flex justify-between">
                <dt className="text-foreground-secondary">Billed</dt>
                <dd data-testid="subscribe-interval-price">
                  {quote.intervalLabel} · {formatInr(quote.intervalPrices?.[quote.interval ?? interval] ?? quote.unitPrice)}{' '}
                  each
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-foreground-secondary">
                  {formatInr(quote.unitPrice)} × {quote.quantity}
                </dt>
                <dd>{formatInr(quote.unitPrice * quote.quantity)}</dd>
              </div>
              {!quote.isDigital && (
                <div className="flex justify-between">
                  <dt className="text-foreground-secondary">Shipping</dt>
                  <dd>{quote.shipping > 0 ? formatInr(quote.shipping) : selected ? 'Free' : '—'}</dd>
                </div>
              )}
              <div className="flex justify-between font-semibold border-t border-border-default pt-2">
                <dt>Total per cycle</dt>
                <dd>{formatInr(quote.amount)}</dd>
              </div>
              <SavingsNote oneTimePrice={quote.oneTimePrice} unitPrice={quote.unitPrice} />
              <TermNote totalCycles={quote.totalCycles} minCycles={quote.minCycles} digital={quote.isDigital} />
            </dl>
          )}

          <label className="flex gap-2 items-start text-xs text-foreground-secondary">
            <input
              type="checkbox"
              aria-label="I agree to the auto-debit terms"
              checked={consent}
              onChange={e => setConsent(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              I authorise an auto-debit of {quote ? formatInr(quote.amount) : 'the amount above'}{' '}
              {quote ? quote.intervalLabel.toLowerCase() : 'each cycle'}{' '}
              {quote?.totalCycles ? `for ${quote.totalCycles} charges, after which it ends` : 'until I cancel'}. The
              first cycle is charged now.{' '}
              {quote?.minCycles
                ? `This subscription has a minimum commitment of ${quote.minCycles} charges; I can cancel or pause from My subscriptions only after charge ${quote.minCycles}.`
                : 'I can cancel anytime from My subscriptions;'}{' '}
              cancellation takes effect at the end of the current cycle. The mandate will show the merchant name <strong>{merchant}</strong>. Subscriptions are limited to{' '}
              {formatInr(MAX_CYCLE_AMOUNT_INR)} per cycle.
            </span>
          </label>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <button
            type="button"
            onClick={pay}
            disabled={!canPay}
            className="w-full bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Processing…' : quote ? `Pay ${formatInr(quote.amount)} & subscribe` : 'Subscribe'}
          </button>
        </section>
      </div>

      <AddressFormModal
        isOpen={showAddressModal}
        onClose={() => setShowAddressModal(false)}
        onSaved={a => {
          setShowAddressModal(false)
          fetchAddresses(a.id)
        }}
        {...(isBusiness ? { portalHeader: 'business' } : {})}
      />
    </div>
  )
}

export function SubscribeCheckoutVisitor() {
  return (
    <Suspense>
      <SubscribeCheckout isBusiness={false} />
    </Suspense>
  )
}

export function SubscribeCheckoutBusiness() {
  return (
    <Suspense>
      <SubscribeCheckout isBusiness={true} />
    </Suspense>
  )
}
