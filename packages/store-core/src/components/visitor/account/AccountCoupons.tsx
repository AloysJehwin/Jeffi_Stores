'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { useToast } from '@/contexts/ToastContext'
import type { AccountCoupon, CouponStatus } from '@/lib/rewards/account-coupons'
import { cartCouponHref, couponTerms, formatExpiry } from '@/components/visitor/coupons/terms'

const STATUS: Record<CouponStatus, { label: string; className: string }> = {
  usable: { label: 'Ready to use', className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
  used: { label: 'Used', className: 'bg-surface-secondary text-foreground-secondary' },
  expired: { label: 'Expired', className: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
}

const SOURCE: Record<AccountCoupon['source'], string> = {
  game: 'Won in the rewards game',
  loyalty: 'Redeemed points',
  store: 'From the store',
}

/** Account → Rewards: every personal coupon with its status; usable ones go to the cart. */
export default function AccountCoupons({ coupons }: { coupons: AccountCoupon[] }) {
  const { showToast } = useToast()
  const ref = useRef<HTMLDivElement>(null)
  const scrolled = useRef(false)

  // The section loads after the page, so a #coupons link needs a nudge to land on it.
  useEffect(() => {
    if (scrolled.current || coupons.length === 0 || window.location.hash !== '#coupons') return
    scrolled.current = true
    ref.current?.scrollIntoView({ block: 'start' })
  }, [coupons.length])

  if (coupons.length === 0) return null

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      showToast('Coupon code copied', 'success')
    } catch {
      showToast('Could not copy the code', 'error')
    }
  }

  return (
    <div
      id="coupons"
      ref={ref}
      className="scroll-mt-24 bg-surface-elevated rounded-xl shadow-sm border border-border-default p-5 sm:p-6"
    >
      <h2 className="font-semibold text-foreground">Your coupons</h2>
      <p className="mt-1 text-sm text-foreground-secondary">
        Apply one in your cart, or enter the code in the coupon box at checkout.
      </p>
      <ul className="mt-4 space-y-3">
        {coupons.map(coupon => {
          const status = STATUS[coupon.status]
          const usable = coupon.status === 'usable'
          return (
            <li key={coupon.id} className="rounded-lg border border-dashed border-border-default px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p
                      className={`font-mono font-semibold break-all ${usable ? 'text-foreground' : 'text-foreground-muted line-through'}`}
                    >
                      {coupon.code}
                    </p>
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>
                      {status.label}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-foreground-secondary">{couponTerms(coupon, { expiry: false })}</p>
                  <p className="text-xs text-foreground-muted">
                    {coupon.source === 'store' ? (coupon.label ?? SOURCE.store) : SOURCE[coupon.source]}
                    {coupon.validUntil
                      ? ` · ${new Date(coupon.validUntil) <= new Date() ? 'expired' : 'valid till'} ${formatExpiry(coupon.validUntil)}`
                      : ''}
                  </p>
                </div>
                {usable && (
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => copy(coupon.code)}
                      aria-label={`Copy coupon ${coupon.code}`}
                      className="px-3 py-1.5 rounded-lg border border-border-default text-sm text-foreground-secondary hover:bg-surface-secondary"
                    >
                      Copy
                    </button>
                    <Link
                      href={cartCouponHref(coupon.code)}
                      className="px-3 py-1.5 rounded-lg bg-accent-500 text-sm font-medium text-white hover:bg-accent-600"
                    >
                      Apply in cart
                    </Link>
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
