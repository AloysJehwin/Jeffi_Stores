'use client'

import { useAuth } from '@/contexts/AuthContext'

interface Props {
  price: number
  categoryId?: string
}

export default function BusinessPriceBadge({ price, categoryId }: Props) {
  const { user } = useAuth()

  if (!user?.isBusiness || user.approvalStatus !== 'approved' || !categoryId) return null
  if (!user.businessDiscountMap) return null

  const discountPct = user.businessDiscountMap[categoryId] ?? 0
  if (discountPct <= 0) return null

  const discountedPrice = price * (1 - discountPct / 100)

  return (
    <div className="mt-3 pt-3 border-t border-accent-200 dark:border-accent-800 flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-accent-100 dark:bg-accent-900/40 text-accent-700 dark:text-accent-300 border border-accent-200 dark:border-accent-700">
          Business {discountPct}% off
        </span>
        <span className="text-lg font-bold text-accent-600 dark:text-accent-400">
          Rs. {discountedPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
        </span>
      </div>
      <span className="text-xs text-foreground-muted">Your exclusive business price</span>
    </div>
  )
}
