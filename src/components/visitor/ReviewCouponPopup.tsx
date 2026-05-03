'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'

interface Coupon {
  id: string
  code: string
  description: string | null
  discount_type: string
  discount_value: number
  valid_until: string | null
}

export default function ReviewCouponPopup() {
  const { user } = useAuth()
  const [coupon, setCoupon] = useState<Coupon | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!user) return
    if (sessionStorage.getItem('rfcoupon_dismissed') === '1') return

    fetch('/api/user/review-coupons')
      .then(r => r.json())
      .then(data => {
        if (data.coupon) {
          setCoupon(data.coupon)
          setVisible(true)
        }
      })
      .catch(() => {})
  }, [user])

  if (!visible || !coupon) return null

  const discountText = coupon.discount_type === 'percentage'
    ? `${coupon.discount_value}% off`
    : `₹${coupon.discount_value} off`

  const dismiss = () => {
    sessionStorage.setItem('rfcoupon_dismissed', '1')
    setVisible(false)
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-72 bg-white rounded-2xl shadow-2xl border border-orange-100 overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
      <div style={{ background: '#1a3a4a' }} className="px-4 py-2.5 flex items-center justify-between">
        <span className="text-white text-xs font-semibold">You earned a reward!</span>
        <button onClick={dismiss} className="text-white/60 hover:text-white text-lg leading-none">×</button>
      </div>
      <div className="p-4 space-y-3">
        <div className="bg-gradient-to-r from-orange-500 to-orange-600 rounded-xl p-3 text-white text-center space-y-0.5">
          <p className="text-xs font-medium opacity-90">{discountText} on your next order</p>
          <p className="text-2xl font-black tracking-widest">{coupon.code}</p>
          {coupon.description && <p className="text-xs opacity-80">{coupon.description}</p>}
          {coupon.valid_until && (
            <p className="text-xs opacity-70">Valid until {new Date(coupon.valid_until).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
          )}
        </div>
        <a
          href={`/checkout?couponCode=${encodeURIComponent(coupon.code)}`}
          className="block w-full py-2.5 bg-green-500 hover:bg-green-600 text-white rounded-xl text-sm font-bold text-center transition-colors"
          onClick={dismiss}
        >
          Use at Checkout →
        </a>
      </div>
    </div>
  )
}
