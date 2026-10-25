'use client'

import Link from 'next/link'
import { inr } from './inr'
import { couponTerms } from '@/components/visitor/coupons/terms'
import { useAccountCoupons } from '@/components/visitor/coupons/useAccountCoupons'

const SHOWN = 3

/** The signed-in customer's usable personal coupons (game wins, redeemed points), one tap to apply. */
export default function YourCoupons({
  subtotal,
  applying,
  onApply,
}: {
  subtotal: number
  applying: boolean
  onApply: (code: string) => void
}) {
  const { coupons } = useAccountCoupons(true, { usableOnly: true })
  if (!coupons || coupons.length === 0) return null

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Your coupons</p>
        {coupons.length > SHOWN && (
          <Link
            href="/account/rewards#coupons"
            className="text-xs font-medium text-accent-600 hover:text-accent-700 dark:text-accent-400 dark:hover:text-accent-300"
          >
            See all
          </Link>
        )}
      </div>
      <ul className="mt-1.5 space-y-2">
        {coupons.slice(0, SHOWN).map(coupon => {
          const shortfall = Math.round((coupon.minPurchase - subtotal) * 100) / 100
          return (
            <li
              key={coupon.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-accent-300 dark:border-accent-700 bg-accent-50 dark:bg-accent-900/20 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-sm font-bold text-accent-700 dark:text-accent-300">
                  {coupon.code}
                </p>
                <p className="text-xs text-foreground-secondary">{couponTerms(coupon)}</p>
                {shortfall > 0 && (
                  <p className="text-xs text-foreground-muted">
                    Add <span className="font-semibold text-foreground">{inr(shortfall)}</span> more to use it
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => onApply(coupon.code)}
                disabled={applying || shortfall > 0}
                aria-label={`Apply coupon ${coupon.code}`}
                className="shrink-0 text-xs font-semibold text-accent-600 hover:text-accent-700 dark:text-accent-400 dark:hover:text-accent-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {applying ? 'Applying...' : 'Apply'}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
