'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'
import { trackSubscriptionCheckout, type PlanInfo } from '@controller/lib/client/ecom-analytics'
import PageHeader from '../dashboard/_components/PageHeader'
import { Card } from '../dashboard/_components/Card'
import { Badge, primaryBtn } from './ui'
import { PaymentSections, otherDisplayConfig, upiAutopayDisplayConfig, type PaymentChoice } from '@/components/payments'

interface Props {
  subscriptionId: string
  checkoutUrl: string | null
  slug: string
  displayName: string
  ownerEmail: string
  ownerName: string | null
  planName: string
  plan: PlanInfo
  razorpayKeyId: string
  /** Offer UPI Autopay as its own section (platform UPI flag). */
  upiAutopay?: boolean
}

export default function PaymentTrigger({
  subscriptionId,
  checkoutUrl,
  slug,
  displayName,
  ownerEmail,
  ownerName,
  planName,
  plan,
  razorpayKeyId,
  upiAutopay = false,
}: Props) {
  const router = useRouter()
  const { showToast } = useToast()
  const [busy, setBusy] = useState(false)
  const [scriptLoaded, setScriptLoaded] = useState(false)
  const [method, setMethod] = useState<PaymentChoice>('upi')

  useEffect(() => {
    if ((window as any).Razorpay) {
      setScriptLoaded(true)
      return
    }
    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.onload = () => setScriptLoaded(true)
    script.onerror = () => showToast('Failed to load payment gateway. Please refresh.', 'error')
    document.body.appendChild(script)
    return () => {
      try {
        document.body.removeChild(script)
      } catch {}
    }
  }, [])

  function openCheckout() {
    if (!scriptLoaded) {
      showToast('Payment gateway not ready. Please refresh.', 'error')
      return
    }
    setBusy(true)

    const options = {
      key: razorpayKeyId,
      subscription_id: subscriptionId,
      name: 'Jeffi Commerce',
      description: `${planName} subscription`,
      prefill: {
        email: ownerEmail,
        name: ownerName ?? ownerEmail,
      },
      theme: { color: '#c46a46' },
      // UPI section = Razorpay UPI Autopay only; Other = everything but UPI.
      ...(upiAutopay && { config: method === 'upi' ? upiAutopayDisplayConfig() : otherDisplayConfig() }),
      callback_url: `${window.location.origin}/onboard/success?tenant=${slug}`,
      modal: {
        ondismiss: () => {
          setBusy(false)
        },
      },
    }

    const rzp = new (window as any).Razorpay(options)
    rzp.on('payment.failed', (response: any) => {
      showToast(response.error?.description || 'Payment failed. Please try again.', 'error')
      setBusy(false)
    })
    rzp.open()
    trackSubscriptionCheckout(plan)
  }

  return (
    <>
      <PageHeader eyebrow="Store application" title="Application approved!" actions={<Badge tone="sage">Approved</Badge>} />
      <Card>
        <p className="text-sm text-foreground-secondary break-words">
          Your GST certificate has been verified. Complete your subscription payment to launch{' '}
          <span className="font-semibold text-foreground">{displayName}</span> ({slug}.jeffistores.in).
        </p>
        {upiAutopay && (
          <div className="mt-5 max-w-md">
            <PaymentSections compact mode="autopay" amountInr={plan.monthlyPrice ? Number(plan.monthlyPrice) : null} upi razorpay value={method} onChange={setMethod} />
          </div>
        )}
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button onClick={openCheckout} disabled={busy || !scriptLoaded} className={`${primaryBtn} w-full sm:w-auto px-6`}>
            {busy ? 'Opening payment…' : !scriptLoaded ? 'Loading…' : 'Complete payment'}
          </button>
          <p className="text-xs text-foreground-muted">Secured by Razorpay</p>
        </div>
      </Card>
    </>
  )
}
