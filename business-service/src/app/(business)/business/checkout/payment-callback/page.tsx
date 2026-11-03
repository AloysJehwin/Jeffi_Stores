'use client'

import { useEffect, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Suspense } from 'react'

function PaymentCallbackInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true

    const razorpay_payment_id = searchParams.get('razorpay_payment_id')
    const razorpay_order_id = searchParams.get('razorpay_order_id')
    const razorpay_signature = searchParams.get('razorpay_signature')

    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      router.replace('/business/checkout')
      return
    }

    try {
      const raw = sessionStorage.getItem('rzp_pending_biz')
      const existing = raw ? JSON.parse(raw) : {}
      sessionStorage.setItem(
        'rzp_pending_biz',
        JSON.stringify({
          ...existing,
          razorpayOrderId: razorpay_order_id,
          razorpayPaymentId: razorpay_payment_id,
          razorpaySignature: razorpay_signature,
          ts: Date.now(),
        })
      )
    } catch {}

    router.replace('/business/checkout')
  }, [])

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center">
      <div className="text-center space-y-3">
        <svg className="w-8 h-8 text-accent-500 animate-spin mx-auto" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
        <p className="text-sm text-foreground-secondary">Confirming your payment…</p>
      </div>
    </div>
  )
}

export default function BusinessPaymentCallbackPage() {
  return (
    <Suspense>
      <PaymentCallbackInner />
    </Suspense>
  )
}
