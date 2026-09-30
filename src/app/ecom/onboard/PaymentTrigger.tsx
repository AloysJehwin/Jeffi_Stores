'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  subscriptionId: string
  checkoutUrl: string | null
  slug: string
  displayName: string
  ownerEmail: string
  ownerName: string | null
  planName: string
  razorpayKeyId: string
}

export default function PaymentTrigger({
  subscriptionId,
  checkoutUrl,
  slug,
  displayName,
  ownerEmail,
  ownerName,
  planName,
  razorpayKeyId,
}: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [scriptLoaded, setScriptLoaded] = useState(false)

  useEffect(() => {
    if ((window as any).Razorpay) {
      setScriptLoaded(true)
      return
    }
    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.onload = () => setScriptLoaded(true)
    script.onerror = () => setErr('Failed to load payment gateway. Please refresh.')
    document.body.appendChild(script)
    return () => {
      try {
        document.body.removeChild(script)
      } catch {}
    }
  }, [])

  function openCheckout() {
    if (!scriptLoaded) {
      setErr('Payment gateway not ready. Please refresh.')
      return
    }
    setBusy(true)
    setErr(null)

    const options = {
      key: razorpayKeyId,
      subscription_id: subscriptionId,
      name: 'Jeffi Commerce',
      description: `${planName} subscription`,
      prefill: {
        email: ownerEmail,
        name: ownerName ?? ownerEmail,
      },
      theme: { color: '#16a34a' },
      callback_url: `${window.location.origin}/onboard/success?tenant=${slug}`,
      modal: {
        ondismiss: () => {
          setBusy(false)
        },
      },
    }

    const rzp = new (window as any).Razorpay(options)
    rzp.on('payment.failed', (response: any) => {
      setErr(response.error?.description || 'Payment failed. Please try again.')
      setBusy(false)
    })
    rzp.open()
  }

  return (
    <div className="w-full max-w-lg text-center">
      <div className="rounded-2xl border border-accent-200 dark:border-accent-800 bg-surface-elevated p-10 shadow-lg">
        <div className="w-14 h-14 rounded-full bg-accent-100 dark:bg-accent-900/40 flex items-center justify-center mx-auto mb-5">
          <svg
            className="w-7 h-7 text-accent-600 dark:text-accent-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z"
            />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-foreground">Application approved!</h1>
        <p className="text-sm text-foreground-secondary mt-3">
          Your GST certificate has been verified. Complete your subscription payment to launch{' '}
          <span className="font-semibold">{displayName}</span> ({slug}.jeffistores.in).
        </p>

        {err && <p className="text-sm text-red-600 dark:text-red-400 mt-4">{err}</p>}

        <button
          onClick={openCheckout}
          disabled={busy || !scriptLoaded}
          className="inline-block mt-6 w-full px-6 py-3.5 rounded-xl bg-accent-600 hover:bg-accent-700 disabled:opacity-50 text-white font-semibold text-base transition-colors shadow-md shadow-accent-600/20"
        >
          {busy ? 'Opening payment…' : !scriptLoaded ? 'Loading…' : 'Complete payment'}
        </button>
        <p className="text-xs text-foreground-muted mt-4">Secured by Razorpay</p>
      </div>
    </div>
  )
}
