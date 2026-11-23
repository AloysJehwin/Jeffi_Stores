'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { CART_GLYPH } from './marks'
import { useFlyToCart } from '@/contexts/FlyToCartContext'
import { useCartPulse } from '@/lib/client/use-cart-pulse'

export const HEADER_CART_CLASS =
  'hidden sm:flex p-2.5 min-w-[44px] min-h-[44px] items-center justify-center text-foreground-secondary hover:text-accent-500 transition-all active:scale-95 relative group'

/** The cart icon with its count, which pulses when something is added; the header's and the AI's <CartIcon>. */
export default function CartLink({ count, showCount = true, className = HEADER_CART_CLASS }: { count: number; showCount?: boolean; className?: string }) {
  const pulseBadge = useCartPulse(count)
  const linkRef = useRef<HTMLAnchorElement | null>(null)
  const fly = useFlyToCart()

  useEffect(() => {
    fly?.setCartTarget(linkRef.current)
    return () => fly?.setCartTarget(null)
  }, [fly])

  return (
    <Link ref={linkRef} href="/cart" aria-label={count > 0 ? `Cart, ${count} items` : 'Cart'} className={className}>
      <svg className="w-6 h-6 transition-transform group-hover:scale-110" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={CART_GLYPH} />
      </svg>
      {showCount && count > 0 && (
        <span
          className={`absolute top-0.5 right-0.5 bg-accent-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center transition-transform duration-300 ${pulseBadge ? 'animate-cart-pulse' : ''}`}
        >
          {count}
        </span>
      )}
    </Link>
  )
}
