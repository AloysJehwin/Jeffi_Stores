'use client'

import { useAuth } from '@/contexts/AuthContext'

export default function BusinessDiscountBanner() {
  const { user } = useAuth()
  if (!user?.isBusiness || user.approvalStatus !== 'approved') return null

  const discounts = Object.values(user.businessDiscountMap ?? {}) as number[]
  if (discounts.length === 0) return null

  const maxDiscount = Math.max(...discounts)
  if (maxDiscount <= 0) return null

  const allSame = discounts.every(d => d === maxDiscount)
  const label = allSame
    ? `${maxDiscount}% exclusive business discount on all products`
    : `Up to ${maxDiscount}% exclusive business discount on selected products`

  return (
    <div className="relative overflow-hidden bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 dark:from-amber-600 dark:via-orange-600 dark:to-rose-600">
      {/* Shimmer sweep */}
      <div
        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent animate-shimmer pointer-events-none"
        aria-hidden="true"
      />
      <div className="relative max-w-7xl mx-auto px-4 py-2.5 flex items-center justify-center gap-2.5">
        <span className="text-base" aria-hidden="true">🏷️</span>
        <p className="text-white font-semibold text-sm sm:text-base text-center tracking-wide drop-shadow-sm">
          {label}
        </p>
        <span className="hidden sm:inline-flex items-center gap-1 bg-white/20 text-white text-xs font-bold px-2.5 py-0.5 rounded-full whitespace-nowrap">
          Business Only
        </span>
      </div>
    </div>
  )
}
