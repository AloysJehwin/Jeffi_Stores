'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'

interface Coupon {
  id: string
  code: string
  discount_type: string
  discount_value: number
}

export default function CouponHintBanner() {
  const { user } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [coupon, setCoupon] = useState<Coupon | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!user) return
    if (searchParams.get('couponCode')) return

    fetch('/api/user/review-coupons')
      .then(r => r.json())
      .then(data => { if (data.coupon) setCoupon(data.coupon) })
      .catch(() => {})
  }, [user, searchParams])

  if (!coupon || dismissed || searchParams.get('couponCode')) return null

  const discountText = coupon.discount_type === 'percentage'
    ? `${coupon.discount_value}% off`
    : `₹${coupon.discount_value} off`

  const apply = () => {
    const url = new URL(window.location.href)
    url.searchParams.set('couponCode', coupon.code)
    router.replace(url.pathname + '?' + url.searchParams.toString())
  }

  return (
    <div className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4 text-sm">
      <p className="text-amber-800">
        You earned a coupon — <span className="font-mono font-bold">{coupon.code}</span> ({discountText}).
      </p>
      <div className="flex items-center gap-2 shrink-0">
        <button onClick={apply} className="text-amber-700 font-semibold hover:text-amber-900 transition-colors">
          Apply →
        </button>
        <button onClick={() => setDismissed(true)} className="text-amber-400 hover:text-amber-600">×</button>
      </div>
    </div>
  )
}
