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
    ? `✦ You get ${maxDiscount}% extra off on all products`
    : `✦ You get up to ${maxDiscount}% extra business discount`

  return (
    <div className="flex items-center gap-2 px-3 py-2 mb-4 rounded-lg bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-700">
      <span className="text-sm font-semibold text-primary-700 dark:text-primary-300">{label}</span>
    </div>
  )
}
